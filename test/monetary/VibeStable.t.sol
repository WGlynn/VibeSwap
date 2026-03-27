// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/monetary/VibeStable.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mock Oracle ============

contract MockPriceFeed {
    int256 public answer;
    uint8 public decimals_;

    constructor(int256 _answer, uint8 _decimals) {
        answer = _answer;
        decimals_ = _decimals;
    }

    function setAnswer(int256 _answer) external {
        answer = _answer;
    }

    function decimals() external view returns (uint8) {
        return decimals_;
    }

    function latestRoundData() external view returns (
        uint80, int256, uint256, uint256, uint80
    ) {
        return (1, answer, block.timestamp, block.timestamp, 1);
    }
}

// ============ Mock ERC20 Collateral ============

contract MockCollateral is ERC20 {
    uint8 private _dec;

    constructor(string memory name, string memory symbol, uint8 dec) ERC20(name, symbol) {
        _dec = dec;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title VibeStableTest
 * @notice Unit tests for VibeStable (vUSD) — MakerDAO-style CDP stablecoin
 *
 * Coverage:
 *   - Initialization: name, symbol, decimals, state
 *   - Admin: addCollateralType, configurePSM, setCollateralActive, setDebtCeiling
 *   - Vault ops: openVault, addCollateral, removeCollateral, mintMore, repay
 *   - Collateral ratio enforcement: minimum ratio guards
 *   - Debt ceiling: prevents over-minting
 *   - Liquidation: underwater vault detection, Dutch auction creation
 *   - PSM: psmSwapIn and psmSwapOut with fee, decimal normalization
 *   - PID controller: adjustStabilityFee updates fees
 *   - Access control: all onlyOwner operations
 *   - UUPS upgrade: only owner
 *   - Minting / burning: supply tracks vault operations
 */
contract VibeStableTest is Test {
    VibeStable public vsd;
    VibeStable public impl;

    MockPriceFeed public vusdFeed;      // vUSD price (1.0 = $1.00 in 18 dec)
    MockPriceFeed public collateralFeed; // ETH price ($2000 in 18 dec)

    MockCollateral public weth;
    MockCollateral public usdc;

    address public proxyOwner;
    address public alice;
    address public bob;

    // Minimum collateral ratio for WETH = 150%
    uint256 constant MCR = 15_000;
    uint256 constant DEBT_CEILING = 1_000_000e18;

    // ============ Events ============

    event VaultOpened(uint256 indexed vaultId, address indexed owner, address collateral, uint256 collateralAmount, uint256 debtAmount);
    event CollateralAdded(uint256 indexed vaultId, uint256 amount);
    event DebtMinted(uint256 indexed vaultId, uint256 amount);
    event DebtRepaid(uint256 indexed vaultId, uint256 amount);
    event VaultLiquidated(uint256 indexed vaultId, uint256 auctionId);
    event PSMSwapIn(address indexed user, uint256 usdcAmount, uint256 vusdAmount, uint256 fee);
    event PSMSwapOut(address indexed user, uint256 vusdAmount, uint256 usdcAmount, uint256 fee);

    function setUp() public {
        proxyOwner = makeAddr("owner");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        // Price feeds
        // vUSD at $1.00 (18 decimals, Chainlink 8-decimal format)
        vusdFeed = new MockPriceFeed(1e8, 8);
        // ETH at $2000 (18 decimals feed)
        collateralFeed = new MockPriceFeed(2000e18, 18);

        // Deploy proxy
        impl = new VibeStable();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(VibeStable.initialize, (address(vusdFeed)))
        );
        vsd = VibeStable(address(proxy));
        proxyOwner = vsd.owner();

        // Mock tokens
        weth = new MockCollateral("Wrapped ETH", "WETH", 18);
        usdc = new MockCollateral("USD Coin", "USDC", 6);

        // Mint tokens to users
        weth.mint(alice, 100e18);
        weth.mint(bob, 100e18);
        usdc.mint(alice, 1_000_000e6);
        usdc.mint(bob, 1_000_000e6);

        // Register WETH as collateral
        vm.prank(proxyOwner);
        vsd.addCollateralType(address(weth), MCR, DEBT_CEILING, address(collateralFeed));

        // Configure PSM
        vm.prank(proxyOwner);
        vsd.configurePSM(address(usdc), 6);
    }

    // ============ Initialization ============

    function test_initialize_erc20() public view {
        assertEq(vsd.name(), "VibeSwap USD");
        assertEq(vsd.symbol(), "vUSD");
        assertEq(vsd.decimals(), 18);
        assertEq(vsd.totalSupply(), 0);
    }

    function test_initialize_state() public view {
        assertEq(vsd.nextVaultId(), 1);
        assertEq(vsd.nextAuctionId(), 1);
        assertEq(vsd.vusdPriceFeed(), address(vusdFeed));
        assertEq(vsd.surplusBuffer(), 0);
        assertEq(vsd.badDebt(), 0);
    }

    function test_initialize_constants() public view {
        assertEq(vsd.BPS(), 10_000);
        assertEq(vsd.WAD(), 1e18);
        assertEq(vsd.PSM_FEE_BPS(), 10);
        assertEq(vsd.LIQUIDATION_PENALTY_BPS(), 1300);
        assertEq(vsd.MIN_FEE(), 0.005e18);
        assertEq(vsd.MAX_FEE(), 0.20e18);
    }

    function test_initialize_revert_zeroFeed() public {
        VibeStable impl2 = new VibeStable();
        vm.expectRevert(VibeStable.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(VibeStable.initialize, (address(0)))
        );
    }

    // ============ Admin ============

    function test_addCollateralType() public view {
        VibeStable.CollateralType memory ct = vsd.getCollateralType(address(weth));
        assertEq(ct.token, address(weth));
        assertEq(ct.minCollateralRatio, MCR);
        assertEq(ct.debtCeiling, DEBT_CEILING);
        assertTrue(ct.active);
        assertEq(vsd.collateralCount(), 1);
    }

    function test_addCollateralType_revert_notOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vsd.addCollateralType(address(weth), MCR, DEBT_CEILING, address(collateralFeed));
    }

    function test_addCollateralType_revert_alreadyExists() public {
        vm.prank(proxyOwner);
        vm.expectRevert(VibeStable.CollateralAlreadyExists.selector);
        vsd.addCollateralType(address(weth), MCR, DEBT_CEILING, address(collateralFeed));
    }

    function test_addCollateralType_revert_zeroAddress() public {
        vm.prank(proxyOwner);
        vm.expectRevert(VibeStable.ZeroAddress.selector);
        vsd.addCollateralType(address(0), MCR, DEBT_CEILING, address(collateralFeed));
    }

    function test_setCollateralActive_deactivate() public {
        vm.prank(proxyOwner);
        vsd.setCollateralActive(address(weth), false);

        VibeStable.CollateralType memory ct = vsd.getCollateralType(address(weth));
        assertFalse(ct.active);
    }

    function test_setDebtCeiling() public {
        vm.prank(proxyOwner);
        vsd.setDebtCeiling(address(weth), 500_000e18);

        VibeStable.CollateralType memory ct = vsd.getCollateralType(address(weth));
        assertEq(ct.debtCeiling, 500_000e18);
    }

    function test_setDebtCeiling_revert_notFound() public {
        vm.prank(proxyOwner);
        vm.expectRevert(VibeStable.CollateralNotFound.selector);
        vsd.setDebtCeiling(address(0xdead), 100e18);
    }

    // ============ Vault: Open ============

    function _approveAndOpen(address user_, uint256 collateral, uint256 debt) internal returns (uint256 vaultId) {
        vm.startPrank(user_);
        weth.approve(address(vsd), collateral);
        vaultId = vsd.openVault(address(weth), collateral, debt);
        vm.stopPrank();
    }

    function test_openVault_basic() public {
        // 1 ETH @ $2000 → max borrow at 150% MCR = $2000 / 1.5 ≈ 1333 vUSD
        uint256 collateral = 1e18;
        uint256 debt = 1000e18; // $1000 vUSD — safely overcollateralized

        uint256 vaultId = _approveAndOpen(alice, collateral, debt);

        assertEq(vaultId, 1);
        assertEq(vsd.balanceOf(alice), debt);
        assertEq(vsd.totalSupply(), debt);

        VibeStable.Vault memory v = vsd.getVault(vaultId);
        assertEq(v.owner, alice);
        assertEq(v.collateralToken, address(weth));
        assertEq(v.collateralAmount, collateral);
        assertEq(v.debtAmount, debt);
    }

    function test_openVault_emitsEvent() public {
        vm.startPrank(alice);
        weth.approve(address(vsd), 1e18);

        vm.expectEmit(true, true, false, true);
        emit VaultOpened(1, alice, address(weth), 1e18, 1000e18);
        vsd.openVault(address(weth), 1e18, 1000e18);
        vm.stopPrank();
    }

    function test_openVault_revert_zeroCollateral() public {
        vm.prank(alice);
        vm.expectRevert(VibeStable.ZeroAmount.selector);
        vsd.openVault(address(weth), 0, 100e18);
    }

    function test_openVault_revert_inactiveCollateral() public {
        vm.prank(proxyOwner);
        vsd.setCollateralActive(address(weth), false);

        vm.startPrank(alice);
        weth.approve(address(vsd), 1e18);
        vm.expectRevert(VibeStable.CollateralNotActive.selector);
        vsd.openVault(address(weth), 1e18, 100e18);
        vm.stopPrank();
    }

    function test_openVault_revert_debtCeilingExceeded() public {
        vm.prank(proxyOwner);
        vsd.setDebtCeiling(address(weth), 100e18);

        vm.startPrank(alice);
        weth.approve(address(vsd), 10e18);
        vm.expectRevert(VibeStable.DebtCeilingExceeded.selector);
        vsd.openVault(address(weth), 10e18, 200e18);
        vm.stopPrank();
    }

    function test_openVault_revert_insufficientCollateralRatio() public {
        // 1 ETH @ $2000, trying to mint $1400 (ratio = 142.8% < 150%)
        vm.startPrank(alice);
        weth.approve(address(vsd), 1e18);
        vm.expectRevert(VibeStable.InsufficientCollateralRatio.selector);
        vsd.openVault(address(weth), 1e18, 1400e18);
        vm.stopPrank();
    }

    function test_openVault_zeroDebt_depositsOnly() public {
        // Can open with 0 debt (pure collateral deposit)
        vm.startPrank(alice);
        weth.approve(address(vsd), 1e18);
        uint256 vaultId = vsd.openVault(address(weth), 1e18, 0);
        vm.stopPrank();

        VibeStable.Vault memory v = vsd.getVault(vaultId);
        assertEq(v.debtAmount, 0);
        assertEq(vsd.totalSupply(), 0);
    }

    // ============ Vault: Add / Remove Collateral ============

    function test_addCollateral() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1000e18);

        vm.startPrank(alice);
        weth.approve(address(vsd), 0.5e18);
        vsd.addCollateral(vaultId, 0.5e18);
        vm.stopPrank();

        VibeStable.Vault memory v = vsd.getVault(vaultId);
        assertEq(v.collateralAmount, 1.5e18);
    }

    function test_addCollateral_revert_notOwner() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1000e18);

        vm.startPrank(bob);
        weth.approve(address(vsd), 0.5e18);
        vm.expectRevert(VibeStable.NotVaultOwner.selector);
        vsd.addCollateral(vaultId, 0.5e18);
        vm.stopPrank();
    }

    function test_removeCollateral_keepingRatio() public {
        // 2 ETH @ $2000 = $4000, borrow $1000 (ratio 400%)
        uint256 vaultId = _approveAndOpen(alice, 2e18, 1000e18);

        // Remove 0.5 ETH: 1.5 ETH @ $2000 = $3000, ratio = 300% > 150% ✓
        vm.prank(alice);
        vsd.removeCollateral(vaultId, 0.5e18);

        VibeStable.Vault memory v = vsd.getVault(vaultId);
        assertEq(v.collateralAmount, 1.5e18);
    }

    function test_removeCollateral_revert_belowMCR() public {
        // 1 ETH @ $2000, debt $1300 (ratio ≈ 153% — barely above 150%)
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1300e18);

        // Remove 0.1 ETH would push ratio below 150%
        vm.prank(alice);
        vm.expectRevert(VibeStable.InsufficientCollateralRatio.selector);
        vsd.removeCollateral(vaultId, 0.1e18);
    }

    // ============ Vault: Mint More ============

    function test_mintMore_increasesDebt() public {
        uint256 vaultId = _approveAndOpen(alice, 2e18, 1000e18);

        vm.prank(alice);
        vsd.mintMore(vaultId, 500e18);

        assertEq(vsd.balanceOf(alice), 1500e18);

        VibeStable.Vault memory v = vsd.getVault(vaultId);
        assertEq(v.debtAmount, 1500e18);
    }

    function test_mintMore_revert_debtCeilingExceeded() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1000e18);

        vm.prank(proxyOwner);
        vsd.setDebtCeiling(address(weth), 1000e18); // exactly at current total

        vm.prank(alice);
        vm.expectRevert(VibeStable.DebtCeilingExceeded.selector);
        vsd.mintMore(vaultId, 1);
    }

    function test_mintMore_revert_wouldBreakMCR() public {
        // 1 ETH @ $2000, currently $1000 debt (200% ratio)
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1000e18);

        // Mint $500 more: $1500 debt, ratio = $2000 / $1500 = 133% < 150% → revert
        vm.prank(alice);
        vm.expectRevert(VibeStable.InsufficientCollateralRatio.selector);
        vsd.mintMore(vaultId, 500e18);
    }

    // ============ Vault: Repay ============

    function test_repay_reducesDebtAndBurns() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1000e18);

        vm.prank(alice);
        vsd.repay(vaultId, 400e18);

        assertEq(vsd.balanceOf(alice), 600e18);
        assertEq(vsd.totalSupply(), 600e18);

        VibeStable.Vault memory v = vsd.getVault(vaultId);
        assertEq(v.debtAmount, 600e18);
    }

    function test_repay_fullRepay_returnsCollateral() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1000e18);

        uint256 wethBalBefore = weth.balanceOf(alice);

        vm.prank(alice);
        vsd.repay(vaultId, 1000e18);

        // Collateral returned on full repayment
        assertEq(weth.balanceOf(alice), wethBalBefore + 1e18, "Collateral returned after full repay");
        assertEq(vsd.balanceOf(alice), 0);

        VibeStable.Vault memory v = vsd.getVault(vaultId);
        assertEq(v.collateralAmount, 0);
        assertEq(v.debtAmount, 0);
    }

    function test_repay_caps_atDebt() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1000e18);

        // Overpay — capped at outstanding debt
        vm.prank(alice);
        vsd.repay(vaultId, 5000e18);

        assertEq(vsd.balanceOf(alice), 0);
        VibeStable.Vault memory v = vsd.getVault(vaultId);
        assertEq(v.debtAmount, 0);
    }

    function test_repay_revert_zeroAmount() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1000e18);

        vm.prank(alice);
        vm.expectRevert(VibeStable.ZeroAmount.selector);
        vsd.repay(vaultId, 0);
    }

    // ============ Collateral Ratio View ============

    function test_getCollateralRatio_noDebt_maxUint() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 0);
        assertEq(vsd.getCollateralRatio(vaultId), type(uint256).max);
    }

    function test_getCollateralRatio_accuracy() public {
        // 1 ETH @ $2000, $1000 debt → ratio = 200%
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1000e18);

        uint256 ratio = vsd.getCollateralRatio(vaultId);
        // ratio = (1e18 * 2000e18 / 1e18) * 10000 / 1000e18 = 20000 BPS = 200%
        assertEq(ratio, 20000);
    }

    // ============ Liquidation ============

    function test_liquidate_underwaterVault() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1300e18); // 153% ratio

        // ETH price drops to $1800, ratio = 1800/1300 = 138% < 150%
        collateralFeed.setAnswer(1800e18);

        uint256 auctionId = vsd.liquidate(vaultId);
        assertEq(auctionId, 1);

        VibeStable.LiquidationAuction memory a = vsd.getAuction(auctionId);
        assertEq(a.vaultId, vaultId);
        assertFalse(a.settled);
        assertGt(a.debtToRaise, 1300e18, "Debt includes liquidation penalty");
        assertGt(a.startPrice, a.endPrice);

        // Vault should be cleared
        VibeStable.Vault memory v = vsd.getVault(vaultId);
        assertEq(v.collateralAmount, 0);
        assertEq(v.debtAmount, 0);
    }

    function test_liquidate_revert_aboveMCR() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1000e18); // 200% ratio

        vm.expectRevert(VibeStable.VaultNotLiquidatable.selector);
        vsd.liquidate(vaultId);
    }

    function test_liquidate_revert_zeroDebt() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 0);

        vm.expectRevert(VibeStable.ZeroAmount.selector);
        vsd.liquidate(vaultId);
    }

    // ============ Dutch Auction ============

    function test_getAuctionPrice_decreasesOverTime() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1300e18);
        collateralFeed.setAnswer(1800e18);
        uint256 auctionId = vsd.liquidate(vaultId);

        uint256 priceAtStart = vsd.getAuctionPrice(auctionId);

        vm.warp(block.timestamp + 15 minutes); // half way
        uint256 priceAtHalf = vsd.getAuctionPrice(auctionId);

        assertLt(priceAtHalf, priceAtStart, "Dutch auction price should fall");
    }

    function test_getAuctionPrice_zeroAfterExpiry() public {
        uint256 vaultId = _approveAndOpen(alice, 1e18, 1300e18);
        collateralFeed.setAnswer(1800e18);
        uint256 auctionId = vsd.liquidate(vaultId);

        vm.warp(block.timestamp + 31 minutes);
        assertEq(vsd.getAuctionPrice(auctionId), 0, "Price should be 0 after auction expires");
    }

    // ============ PSM: Swap In/Out ============

    function test_psmSwapIn_mintsVusd() public {
        uint256 usdcIn = 1000e6; // 1000 USDC

        vm.startPrank(alice);
        usdc.approve(address(vsd), usdcIn);
        vsd.psmSwapIn(usdcIn);
        vm.stopPrank();

        uint256 fee = (usdcIn * 10) / 10_000; // 0.1%
        uint256 netUsdc = usdcIn - fee;
        // Scale 6 → 18 decimals
        uint256 expectedVusd = netUsdc * 1e12;

        assertEq(vsd.balanceOf(alice), expectedVusd, "Should receive vUSD at 1:1 minus fee");
        assertGt(vsd.surplusBuffer(), 0, "Fee goes to surplus buffer");
    }

    function test_psmSwapOut_burnsVusdGivesUsdc() public {
        // First swap in to get vUSD
        uint256 usdcIn = 1000e6;
        vm.startPrank(alice);
        usdc.approve(address(vsd), usdcIn);
        vsd.psmSwapIn(usdcIn);

        uint256 vusdBalance = vsd.balanceOf(alice);
        uint256 usdcBefore = usdc.balanceOf(alice);

        // Now swap out
        vsd.psmSwapOut(vusdBalance);
        vm.stopPrank();

        assertEq(vsd.balanceOf(alice), 0, "All vUSD burned");
        assertGt(usdc.balanceOf(alice), usdcBefore, "Should receive USDC back");
    }

    function test_psmSwapIn_revert_notConfigured() public {
        // Deploy fresh proxy without PSM configured
        VibeStable impl2 = new VibeStable();
        ERC1967Proxy proxy2 = new ERC1967Proxy(
            address(impl2),
            abi.encodeCall(VibeStable.initialize, (address(vusdFeed)))
        );
        VibeStable vsd2 = VibeStable(address(proxy2));

        vm.startPrank(alice);
        usdc.approve(address(vsd2), 1000e6);
        vm.expectRevert(VibeStable.PSMNotConfigured.selector);
        vsd2.psmSwapIn(1000e6);
        vm.stopPrank();
    }

    function test_psmSwapIn_revert_zeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(VibeStable.ZeroAmount.selector);
        vsd.psmSwapIn(0);
    }

    function test_psmSwapOut_revert_zeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(VibeStable.ZeroAmount.selector);
        vsd.psmSwapOut(0);
    }

    // ============ PID: Stability Fee Adjustment ============

    function test_adjustStabilityFee_belowPeg_increasesFee() public {
        VibeStable.CollateralType memory ctBefore = vsd.getCollateralType(address(weth));
        uint256 feeBefore = ctBefore.stabilityFee;

        // vUSD trading at $0.90 (below peg) → should increase stability fee
        vusdFeed.setAnswer(0.9e8);

        vm.warp(block.timestamp + 1 hours);
        vsd.adjustStabilityFee();

        VibeStable.CollateralType memory ctAfter = vsd.getCollateralType(address(weth));
        assertGt(ctAfter.stabilityFee, feeBefore, "Fee should increase when vUSD < peg");
    }

    function test_adjustStabilityFee_atPeg_noChange() public {
        // vUSD at exactly $1.00 → no adjustment
        VibeStable.CollateralType memory ctBefore = vsd.getCollateralType(address(weth));

        vm.warp(block.timestamp + 1 hours);
        vsd.adjustStabilityFee(); // error = 0, no change

        VibeStable.CollateralType memory ctAfter = vsd.getCollateralType(address(weth));
        // At peg: error = 1e18 - 1e18 = 0. Adjustment = 0.
        assertEq(ctAfter.stabilityFee, ctBefore.stabilityFee);
    }

    function test_adjustStabilityFee_clampedToMax() public {
        // Simulate extreme deviation to drive rate to max
        vusdFeed.setAnswer(0.01e8); // 99% below peg

        // Call multiple times to build integral
        uint256 t = block.timestamp;
        for (uint256 i = 0; i < 5; i++) {
            t += 1 hours;
            vm.warp(t);
            vsd.adjustStabilityFee();
        }

        VibeStable.CollateralType memory ct = vsd.getCollateralType(address(weth));
        assertLe(ct.stabilityFee, vsd.MAX_FEE(), "Fee clamped at MAX_FEE");
    }

    function test_adjustStabilityFee_clampedToMin() public {
        // vUSD above peg → should decrease fee
        vusdFeed.setAnswer(1.5e8); // 50% above peg

        uint256 t = block.timestamp;
        for (uint256 i = 0; i < 5; i++) {
            t += 1 hours;
            vm.warp(t);
            vsd.adjustStabilityFee();
        }

        VibeStable.CollateralType memory ct = vsd.getCollateralType(address(weth));
        assertGe(ct.stabilityFee, vsd.MIN_FEE(), "Fee clamped at MIN_FEE");
    }

    function test_adjustStabilityFee_sameBlock_noChange() public {
        VibeStable.CollateralType memory ctBefore = vsd.getCollateralType(address(weth));

        // Call twice in same block — second call returns immediately (dt == 0)
        vsd.adjustStabilityFee();
        vsd.adjustStabilityFee();

        VibeStable.CollateralType memory ctAfter = vsd.getCollateralType(address(weth));
        assertEq(ctAfter.stabilityFee, ctBefore.stabilityFee);
    }

    // ============ UUPS Upgrade ============

    function test_upgrade_onlyOwner() public {
        VibeStable newImpl = new VibeStable();

        vm.prank(alice);
        vm.expectRevert();
        vsd.upgradeToAndCall(address(newImpl), "");

        vm.prank(proxyOwner);
        vsd.upgradeToAndCall(address(newImpl), "");
    }

    // ============ Integration: CDP Lifecycle ============

    function test_integration_cdpLifecycle() public {
        // 1. Open vault: 1.5 ETH @ $2000, borrow $1500 vUSD (200% ratio)
        uint256 vaultId = _approveAndOpen(alice, 1.5e18, 1500e18);
        assertEq(vsd.balanceOf(alice), 1500e18);

        // 2. Add more collateral
        vm.startPrank(alice);
        weth.approve(address(vsd), 0.5e18);
        vsd.addCollateral(vaultId, 0.5e18);
        vm.stopPrank();
        assertEq(vsd.getVault(vaultId).collateralAmount, 2e18);

        // 3. Mint more vUSD
        vm.prank(alice);
        vsd.mintMore(vaultId, 500e18);
        assertEq(vsd.balanceOf(alice), 2000e18);

        // 4. Partially repay
        vm.prank(alice);
        vsd.repay(vaultId, 1000e18);
        assertEq(vsd.balanceOf(alice), 1000e18);

        // 5. Fully repay and get collateral back
        uint256 wethBefore = weth.balanceOf(alice);
        vm.prank(alice);
        vsd.repay(vaultId, 1000e18);

        assertEq(weth.balanceOf(alice) - wethBefore, 2e18, "Full collateral returned");
        assertEq(vsd.totalSupply(), 0, "All vUSD burned");
    }

    // ============ Fuzz ============

    function testFuzz_collateralRatio(uint256 collateral, uint256 debt) public {
        // Keep within safe bounds: 2-10 ETH, debt always at 100% MCR
        collateral = bound(collateral, 1e18, 10e18);

        // Calculate max safe debt: collateral * price / MCR_factor
        // MCR = 150%, collateral @ $2000, so max_debt = collateral * 2000 / 1.5
        uint256 maxDebt = (collateral * 2000e18) / (15_000 * 1e14);
        if (maxDebt == 0) return;
        debt = bound(debt, 1, maxDebt);

        vm.startPrank(alice);
        weth.approve(address(vsd), collateral);
        uint256 vaultId = vsd.openVault(address(weth), collateral, debt);
        vm.stopPrank();

        uint256 ratio = vsd.getCollateralRatio(vaultId);
        assertGe(ratio, MCR, "Ratio must be >= MCR after opening");
    }
}
