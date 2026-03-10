// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeVault.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockVaultToken is ERC20 {
    constructor(string memory name, string memory sym) ERC20(name, sym) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @notice Mock price feed: returns fixed price in primary asset terms (18 decimals)
contract MockPriceFeed {
    mapping(address => uint256) public prices;

    function setPrice(address token, uint256 price) external {
        prices[token] = price;
    }

    function getPrice(address token) external view returns (uint256) {
        return prices[token];
    }
}

// ============ Tests ============

contract VibeVaultTest is Test {
    VibeVault public vault;
    MockVaultToken public dai;       // primary asset
    MockVaultToken public weth;      // secondary asset
    MockVaultToken public wbtc;      // secondary asset
    MockPriceFeed public priceFeed;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address keeperAddr = address(0xCC);
    address feeRecipientAddr = address(0xDD);

    uint256 constant TVL_CAP = 1_000_000e18;

    function setUp() public {
        dai = new MockVaultToken("DAI", "DAI");
        weth = new MockVaultToken("WETH", "WETH");
        wbtc = new MockVaultToken("WBTC", "WBTC");
        priceFeed = new MockPriceFeed();

        // Set prices: 1 WETH = 2000 DAI, 1 WBTC = 40000 DAI
        priceFeed.setPrice(address(weth), 2000e18);
        priceFeed.setPrice(address(wbtc), 40000e18);

        // Deploy via proxy (contract has _disableInitializers)
        VibeVault impl = new VibeVault();
        bytes memory initData = abi.encodeCall(
            VibeVault.initialize,
            (
                IERC20(address(dai)),
                "VibeVault DAI",
                "vDAI",
                address(this),
                keeperAddr,
                feeRecipientAddr,
                TVL_CAP
            )
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        vault = VibeVault(address(proxy));

        // Whitelist secondary assets
        vault.whitelistAsset(address(weth), address(priceFeed), 4000); // 40% max
        vault.whitelistAsset(address(wbtc), address(priceFeed), 3000); // 30% max

        // Fund accounts
        dai.mint(alice, 500_000e18);
        dai.mint(bob, 500_000e18);
        weth.mint(alice, 1000e18);
        weth.mint(bob, 1000e18);
        wbtc.mint(alice, 100e18);

        // Approvals
        vm.prank(alice);
        dai.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        weth.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        wbtc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        dai.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        weth.approve(address(vault), type(uint256).max);
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(vault.asset(), address(dai));
        assertEq(vault.name(), "VibeVault DAI");
        assertEq(vault.symbol(), "vDAI");
        assertEq(vault.keeper(), keeperAddr);
        assertEq(vault.feeRecipient(), feeRecipientAddr);
        assertEq(vault.tvlCap(), TVL_CAP);
        assertFalse(vault.emergencyMode());
        assertEq(vault.priceSnapshotCount(), 1); // initial snapshot
    }

    function test_revertInitializeZeroOwner() public {
        VibeVault impl2 = new VibeVault();
        bytes memory initData = abi.encodeCall(
            VibeVault.initialize,
            (IERC20(address(dai)), "V", "V", address(0), keeperAddr, feeRecipientAddr, 0)
        );
        vm.expectRevert(VibeVault.ZeroAddress.selector);
        new ERC1967Proxy(address(impl2), initData);
    }

    function test_revertInitializeZeroFeeRecipient() public {
        VibeVault impl2 = new VibeVault();
        bytes memory initData = abi.encodeCall(
            VibeVault.initialize,
            (IERC20(address(dai)), "V", "V", address(this), keeperAddr, address(0), 0)
        );
        vm.expectRevert(VibeVault.ZeroAddress.selector);
        new ERC1967Proxy(address(impl2), initData);
    }

    // ============ ERC-4626 Deposit ============

    function test_deposit() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(10_000e18, alice);

        assertEq(shares, 10_000e18); // 1:1 for first deposit
        assertEq(vault.balanceOf(alice), 10_000e18);
        assertEq(vault.totalAssets(), 10_000e18);
    }

    function test_depositMultiple() public {
        vm.prank(alice);
        vault.deposit(10_000e18, alice);

        vm.prank(bob);
        uint256 shares = vault.deposit(10_000e18, bob);

        assertEq(shares, 10_000e18); // same share price
        assertEq(vault.totalAssets(), 20_000e18);
    }

    function test_revertDepositZero() public {
        vm.prank(alice);
        vm.expectRevert(VibeVault.ZeroAmount.selector);
        vault.deposit(0, alice);
    }

    function test_revertDepositExceedsTvlCap() public {
        vm.prank(alice);
        // TVL cap is 1M, try to deposit more
        dai.mint(alice, 2_000_000e18);
        vm.prank(alice);
        dai.approve(address(vault), type(uint256).max);

        vm.prank(alice);
        vm.expectRevert();
        vault.deposit(1_500_000e18, alice);
    }

    function test_depositRecordCreated() public {
        vm.prank(alice);
        vault.deposit(5000e18, alice);

        VibeVault.DepositRecord[] memory records = vault.getDepositRecords(alice);
        assertEq(records.length, 1);
        assertEq(records[0].shares, 5000e18);
        assertEq(records[0].depositTime, block.timestamp);
    }

    // ============ ERC-4626 Mint ============

    function test_mint() public {
        vm.prank(alice);
        uint256 assets = vault.mint(5000e18, alice);

        assertEq(assets, 5000e18); // 1:1 first deposit
        assertEq(vault.balanceOf(alice), 5000e18);
    }

    function test_revertMintZero() public {
        vm.prank(alice);
        vm.expectRevert(VibeVault.ZeroAmount.selector);
        vault.mint(0, alice);
    }

    // ============ ERC-4626 Withdraw ============

    function test_withdraw() public {
        vm.prank(alice);
        vault.deposit(10_000e18, alice);

        // Mature the deposit (30 days) to avoid early exit fee
        vm.warp(block.timestamp + 30 days);

        uint256 balanceBefore = dai.balanceOf(alice);
        vm.prank(alice);
        vault.withdraw(5000e18, alice, alice);

        assertEq(dai.balanceOf(alice), balanceBefore + 5000e18);
    }

    function test_revertWithdrawZero() public {
        vm.prank(alice);
        vm.expectRevert(VibeVault.ZeroAmount.selector);
        vault.withdraw(0, alice, alice);
    }

    // ============ ERC-4626 Redeem ============

    function test_redeem() public {
        vm.prank(alice);
        vault.deposit(10_000e18, alice);

        // Mature
        vm.warp(block.timestamp + 30 days);

        uint256 balanceBefore = dai.balanceOf(alice);
        vm.prank(alice);
        uint256 assets = vault.redeem(5000e18, alice, alice);

        assertEq(assets, 5000e18);
        assertEq(dai.balanceOf(alice), balanceBefore + assets);
        assertEq(vault.balanceOf(alice), 5000e18);
    }

    function test_revertRedeemZero() public {
        vm.prank(alice);
        vm.expectRevert(VibeVault.ZeroAmount.selector);
        vault.redeem(0, alice, alice);
    }

    // ============ Early Exit Fee ============

    function test_earlyExitFeeCharged() public {
        vm.prank(alice);
        vault.deposit(10_000e18, alice);

        // Redeem immediately — should incur 0.5% early exit fee
        vm.prank(alice);
        uint256 assets = vault.redeem(10_000e18, alice, alice);

        // With 0.5% fee on 10000 shares → effectiveShares = 10000 - 50 = 9950
        // assets = 9950e18 (since 1:1 ratio)
        assertLt(assets, 10_000e18, "Should get less due to early exit fee");
        assertEq(assets, 9950e18);
    }

    function test_noFeeAfterMaturity() public {
        vm.prank(alice);
        vault.deposit(10_000e18, alice);

        // Wait past maturity period
        vm.warp(block.timestamp + 30 days);

        vm.prank(alice);
        uint256 assets = vault.redeem(10_000e18, alice, alice);

        assertEq(assets, 10_000e18, "No fee after maturity period");
    }

    function test_partialEarlyExitFee() public {
        // Deposit at two different times
        vm.prank(alice);
        vault.deposit(5000e18, alice);

        // Mature first deposit
        vm.warp(block.timestamp + 30 days);

        // Second deposit (immature)
        vm.prank(alice);
        vault.deposit(5000e18, alice);

        // Preview fee for full redemption — only immature shares get fee
        uint256 feeBps = vault.previewExitFee(alice, 10_000e18);
        assertGt(feeBps, 0, "Should have partial fee");
        assertLt(feeBps, 50, "Fee should be less than full 0.5% (only half immature)");
    }

    function test_previewExitFeeNoRecords() public view {
        uint256 feeBps = vault.previewExitFee(alice, 1000e18);
        assertEq(feeBps, 0);
    }

    // ============ Secondary Asset Whitelist ============

    function test_whitelistAsset() public view {
        (bool whitelisted, , uint256 concentrationCap, ) = vault.assetConfigs(address(weth));
        assertTrue(whitelisted);
        assertEq(concentrationCap, 4000);
    }

    function test_getSecondaryAssets() public view {
        address[] memory assets = vault.getSecondaryAssets();
        assertEq(assets.length, 2);
        assertEq(assets[0], address(weth));
        assertEq(assets[1], address(wbtc));
    }

    function test_revertWhitelistDuplicate() public {
        vm.expectRevert(abi.encodeWithSelector(VibeVault.AssetAlreadyWhitelisted.selector, address(weth)));
        vault.whitelistAsset(address(weth), address(priceFeed), 4000);
    }

    function test_revertWhitelistPrimaryAsset() public {
        vm.expectRevert(abi.encodeWithSelector(VibeVault.AssetAlreadyWhitelisted.selector, address(dai)));
        vault.whitelistAsset(address(dai), address(priceFeed), 4000);
    }

    function test_revertWhitelistZeroAddress() public {
        vm.expectRevert(VibeVault.ZeroAddress.selector);
        vault.whitelistAsset(address(0), address(priceFeed), 4000);
    }

    function test_revertWhitelistZeroPriceFeed() public {
        MockVaultToken newToken = new MockVaultToken("X", "X");
        vm.expectRevert(VibeVault.ZeroAddress.selector);
        vault.whitelistAsset(address(newToken), address(0), 4000);
    }

    function test_revertWhitelistInvalidConcentration() public {
        MockVaultToken newToken = new MockVaultToken("X", "X");
        vm.expectRevert(VibeVault.InvalidConcentrationCap.selector);
        vault.whitelistAsset(address(newToken), address(priceFeed), 0);

        MockVaultToken newToken2 = new MockVaultToken("Y", "Y");
        vm.expectRevert(VibeVault.InvalidConcentrationCap.selector);
        vault.whitelistAsset(address(newToken2), address(priceFeed), 5000); // > 4000 MAX
    }

    function test_revertWhitelistNotOwner() public {
        MockVaultToken newToken = new MockVaultToken("X", "X");
        vm.prank(alice);
        vm.expectRevert();
        vault.whitelistAsset(address(newToken), address(priceFeed), 4000);
    }

    function test_removeAsset() public {
        vault.removeAsset(address(wbtc));

        address[] memory assets = vault.getSecondaryAssets();
        assertEq(assets.length, 1);
        assertEq(assets[0], address(weth));

        (bool whitelisted, , , ) = vault.assetConfigs(address(wbtc));
        assertFalse(whitelisted);
    }

    function test_revertRemoveNonWhitelisted() public {
        MockVaultToken newToken = new MockVaultToken("X", "X");
        vm.expectRevert(abi.encodeWithSelector(VibeVault.AssetNotWhitelisted.selector, address(newToken)));
        vault.removeAsset(address(newToken));
    }

    // ============ Secondary Deposit ============

    function test_depositSecondary() public {
        // First deposit primary to establish share price
        vm.prank(alice);
        vault.deposit(100_000e18, alice);

        // Deposit 1 WETH (= 2000 DAI in value)
        vm.prank(alice);
        uint256 shares = vault.depositSecondary(address(weth), 1e18, 0);

        assertGt(shares, 0, "Should receive shares");
        // 1 WETH = 2000 DAI, total vault was 100k DAI → shares ≈ 2000 * (100k shares / 100k value)
        assertEq(shares, 2000e18);
    }

    function test_revertDepositSecondaryNotWhitelisted() public {
        MockVaultToken newToken = new MockVaultToken("X", "X");
        newToken.mint(alice, 1000e18);
        vm.prank(alice);
        newToken.approve(address(vault), type(uint256).max);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VibeVault.AssetNotWhitelisted.selector, address(newToken)));
        vault.depositSecondary(address(newToken), 100e18, 0);
    }

    function test_revertDepositSecondaryZero() public {
        vm.prank(alice);
        vm.expectRevert(VibeVault.ZeroAmount.selector);
        vault.depositSecondary(address(weth), 0, 0);
    }

    function test_revertDepositSecondarySlippage() public {
        vm.prank(alice);
        vault.deposit(100_000e18, alice);

        // Expect more shares than possible
        vm.prank(alice);
        vm.expectRevert(VibeVault.SlippageExceeded.selector);
        vault.depositSecondary(address(weth), 1e18, 100_000e18);
    }

    function test_depositSecondaryTvlCapEnforced() public {
        vm.prank(alice);
        vault.deposit(400_000e18, alice);
        vm.prank(bob);
        vault.deposit(400_000e18, bob);

        // Total is 800k DAI, cap is 1M. Adding 200 WETH = 400k DAI value → exceeds cap
        weth.mint(alice, 200e18);
        vm.prank(alice);
        weth.approve(address(vault), type(uint256).max);

        vm.prank(alice);
        vm.expectRevert();
        vault.depositSecondary(address(weth), 200e18, 0);
    }

    // ============ Secondary Withdraw ============

    function test_withdrawSecondary() public {
        vm.prank(alice);
        vault.deposit(100_000e18, alice);

        vm.prank(alice);
        vault.depositSecondary(address(weth), 10e18, 0);

        uint256 aliceShares = vault.balanceOf(alice);
        // Mature deposits
        vm.warp(block.timestamp + 30 days);

        // Withdraw some WETH using shares
        uint256 sharesToBurn = 2000e18; // worth ~2000 DAI
        vm.prank(alice);
        uint256 amount = vault.withdrawSecondary(address(weth), sharesToBurn, 0);

        assertGt(amount, 0, "Should receive secondary tokens");
    }

    function test_revertWithdrawSecondaryZero() public {
        vm.prank(alice);
        vm.expectRevert(VibeVault.ZeroAmount.selector);
        vault.withdrawSecondary(address(weth), 0, 0);
    }

    // ============ Total Vault Value ============

    function test_totalVaultValuePrimaryOnly() public {
        vm.prank(alice);
        vault.deposit(50_000e18, alice);

        assertEq(vault.totalVaultValue(), 50_000e18);
    }

    function test_totalVaultValueMultiAsset() public {
        vm.prank(alice);
        vault.deposit(100_000e18, alice);

        vm.prank(alice);
        vault.depositSecondary(address(weth), 5e18, 0);

        // 100k DAI + 5 WETH * 2000 = 110k
        assertEq(vault.totalVaultValue(), 110_000e18);
    }

    // ============ Concentration Limits ============

    function test_assetConcentration() public {
        vm.prank(alice);
        vault.deposit(100_000e18, alice);

        // Primary asset concentration = 100%
        uint256 conc = vault.assetConcentration(address(dai));
        assertEq(conc, 10000); // 100% in BPS
    }

    function test_concentrationAfterSecondaryDeposit() public {
        vm.prank(alice);
        vault.deposit(100_000e18, alice);

        // Deposit 10 WETH = 20k DAI value → 20k / 120k = 16.67%
        vm.prank(alice);
        vault.depositSecondary(address(weth), 10e18, 0);

        uint256 wethConc = vault.assetConcentration(address(weth));
        // 20k / 120k ≈ 1666 BPS
        assertApproxEqAbs(wethConc, 1666, 1);
    }

    function test_setConcentrationCap() public {
        vault.setConcentrationCap(address(weth), 2000);
        (, , uint256 cap, ) = vault.assetConfigs(address(weth));
        assertEq(cap, 2000);
    }

    function test_revertSetConcentrationCapNotWhitelisted() public {
        MockVaultToken newToken = new MockVaultToken("X", "X");
        vm.expectRevert(abi.encodeWithSelector(VibeVault.AssetNotWhitelisted.selector, address(newToken)));
        vault.setConcentrationCap(address(newToken), 2000);
    }

    function test_revertSetConcentrationCapInvalid() public {
        vm.expectRevert(VibeVault.InvalidConcentrationCap.selector);
        vault.setConcentrationCap(address(weth), 0);

        vm.expectRevert(VibeVault.InvalidConcentrationCap.selector);
        vault.setConcentrationCap(address(weth), 5000); // > MAX_CONCENTRATION_BPS
    }

    function test_isHealthy() public {
        vm.prank(alice);
        vault.deposit(100_000e18, alice);

        assertTrue(vault.isHealthy());
    }

    // ============ TVL Cap ============

    function test_utilizationRatio() public {
        vm.prank(alice);
        vault.deposit(500_000e18, alice);

        // 500k / 1M = 50% = 5000 BPS
        assertEq(vault.utilizationRatio(), 5000);
    }

    function test_utilizationRatioNoCap() public {
        vault.setTvlCap(0);

        vm.prank(alice);
        vault.deposit(100_000e18, alice);

        assertEq(vault.utilizationRatio(), 0);
    }

    function test_setTvlCap() public {
        vault.setTvlCap(2_000_000e18);
        assertEq(vault.tvlCap(), 2_000_000e18);
    }

    function test_unlimitedTvlCap() public {
        vault.setTvlCap(0);

        // Should be able to deposit any amount
        dai.mint(alice, 10_000_000e18);
        vm.prank(alice);
        dai.approve(address(vault), type(uint256).max);
        vm.prank(alice);
        vault.deposit(5_000_000e18, alice);

        assertEq(vault.totalAssets(), 5_000_000e18);
    }

    // ============ Emergency Mode ============

    function test_activateEmergencyMode() public {
        vault.activateEmergencyMode();
        assertTrue(vault.emergencyMode());
    }

    function test_revertActivateAlreadyActive() public {
        vault.activateEmergencyMode();
        vm.expectRevert(VibeVault.EmergencyModeActive.selector);
        vault.activateEmergencyMode();
    }

    function test_deactivateEmergencyMode() public {
        vault.activateEmergencyMode();
        vault.deactivateEmergencyMode();
        assertFalse(vault.emergencyMode());
    }

    function test_revertDeactivateNotActive() public {
        vm.expectRevert(VibeVault.EmergencyModeNotActive.selector);
        vault.deactivateEmergencyMode();
    }

    function test_emergencyBlocksDeposits() public {
        vault.activateEmergencyMode();

        vm.prank(alice);
        vm.expectRevert(VibeVault.EmergencyModeActive.selector);
        vault.deposit(1000e18, alice);
    }

    function test_emergencyBlocksMint() public {
        vault.activateEmergencyMode();

        vm.prank(alice);
        vm.expectRevert(VibeVault.EmergencyModeActive.selector);
        vault.mint(1000e18, alice);
    }

    function test_emergencyBlocksSecondaryDeposit() public {
        vault.activateEmergencyMode();

        vm.prank(alice);
        vm.expectRevert(VibeVault.EmergencyModeActive.selector);
        vault.depositSecondary(address(weth), 1e18, 0);
    }

    function test_emergencyAllowsWithdrawals() public {
        vm.prank(alice);
        vault.deposit(10_000e18, alice);

        vm.warp(block.timestamp + 30 days);

        vault.activateEmergencyMode();

        // Withdrawals should still work
        vm.prank(alice);
        vault.redeem(5000e18, alice, alice);

        assertEq(vault.balanceOf(alice), 5000e18);
    }

    function test_revertEmergencyNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.activateEmergencyMode();
    }

    // ============ Pause ============

    function test_pause() public {
        vault.pause();

        vm.prank(alice);
        vm.expectRevert();
        vault.deposit(1000e18, alice);
    }

    function test_unpause() public {
        vault.pause();
        vault.unpause();

        vm.prank(alice);
        vault.deposit(1000e18, alice);
        assertEq(vault.balanceOf(alice), 1000e18);
    }

    function test_pauseBlocksWithdrawals() public {
        vm.prank(alice);
        vault.deposit(10_000e18, alice);

        vault.pause();

        vm.prank(alice);
        vm.expectRevert();
        vault.withdraw(5000e18, alice, alice);
    }

    // ============ Keeper ============

    function test_setKeeper() public {
        address newKeeper = address(0xEEEE);
        vault.setKeeper(newKeeper);
        assertEq(vault.keeper(), newKeeper);
    }

    function test_rebalanceCooldown() public {
        // Warp past initial cooldown (lastRebalanceTime=0, cooldown=1h)
        vm.warp(block.timestamp + 2 hours);

        VibeVault.RebalanceOrder[] memory orders = new VibeVault.RebalanceOrder[](0);
        vm.prank(keeperAddr);
        vault.rebalance(orders);

        // Try again immediately — should fail cooldown
        vm.prank(keeperAddr);
        vm.expectRevert(VibeVault.RebalanceCooldown.selector);
        vault.rebalance(orders);
    }

    function test_rebalanceAfterCooldown() public {
        vm.warp(block.timestamp + 2 hours);

        VibeVault.RebalanceOrder[] memory orders = new VibeVault.RebalanceOrder[](0);
        vm.prank(keeperAddr);
        vault.rebalance(orders);

        // Wait 1 hour cooldown
        vm.warp(block.timestamp + 1 hours);

        vm.prank(keeperAddr);
        vault.rebalance(orders); // should succeed
    }

    function test_revertRebalanceNotKeeper() public {
        vm.warp(block.timestamp + 2 hours);
        VibeVault.RebalanceOrder[] memory orders = new VibeVault.RebalanceOrder[](0);
        vm.prank(alice);
        vm.expectRevert(VibeVault.NotKeeper.selector);
        vault.rebalance(orders);
    }

    function test_ownerCanRebalance() public {
        vm.warp(block.timestamp + 2 hours);
        VibeVault.RebalanceOrder[] memory orders = new VibeVault.RebalanceOrder[](0);
        // Owner (address(this)) should also be allowed
        vault.rebalance(orders);
    }

    function test_reportRebalanceReceived() public {
        vm.prank(alice);
        vault.deposit(100_000e18, alice);

        // Keeper reports receiving WETH
        weth.mint(address(vault), 5e18);
        vm.prank(keeperAddr);
        vault.reportRebalanceReceived(address(weth), 5e18);

        (, , , uint256 balance) = vault.assetConfigs(address(weth));
        assertEq(balance, 5e18);
    }

    // ============ Fee Recipient ============

    function test_setFeeRecipient() public {
        address newRecipient = address(0xEEEE);
        vault.setFeeRecipient(newRecipient);
        assertEq(vault.feeRecipient(), newRecipient);
    }

    function test_revertSetFeeRecipientZero() public {
        vm.expectRevert(VibeVault.ZeroAddress.selector);
        vault.setFeeRecipient(address(0));
    }

    // ============ TWAP Share Price ============

    function test_twapSharePrice() public {
        vm.prank(alice);
        vault.deposit(10_000e18, alice);

        uint256 twap = vault.twapSharePrice();
        assertEq(twap, 1e18, "TWAP should be 1e18 at start");
    }

    function test_priceSnapshotCount() public {
        // Initial snapshot from initialize + deposit
        vm.prank(alice);
        vault.deposit(10_000e18, alice);

        // Initialize records 1 snapshot, deposit records another
        assertEq(vault.priceSnapshotCount(), 2);
    }

    // ============ Deposit Records & FIFO ============

    function test_depositRecordsFIFO() public {
        vm.prank(alice);
        vault.deposit(5000e18, alice);

        vm.warp(block.timestamp + 15 days);

        vm.prank(alice);
        vault.deposit(5000e18, alice);

        VibeVault.DepositRecord[] memory records = vault.getDepositRecords(alice);
        assertEq(records.length, 2);
        assertLt(records[0].depositTime, records[1].depositTime);
    }

    function test_depositRecordsConsumedOnRedeem() public {
        vm.prank(alice);
        vault.deposit(10_000e18, alice);

        vm.warp(block.timestamp + 30 days);

        // Redeem all
        vm.prank(alice);
        vault.redeem(10_000e18, alice, alice);

        VibeVault.DepositRecord[] memory records = vault.getDepositRecords(alice);
        // Record still exists but shares should be 0
        assertEq(records[0].shares, 0);
    }

    // ============ Views ============

    function test_totalAssetsInitiallyZero() public view {
        assertEq(vault.totalAssets(), 0);
    }

    function test_cachedTotalValue() public {
        vm.prank(alice);
        vault.deposit(50_000e18, alice);

        assertEq(vault.cachedTotalValue(), 50_000e18);
    }

    // ============ Full Lifecycle ============

    function test_fullLifecycle() public {
        // 1. Alice deposits primary
        vm.prank(alice);
        vault.deposit(100_000e18, alice);
        assertEq(vault.balanceOf(alice), 100_000e18);

        // 2. Bob deposits primary
        vm.prank(bob);
        vault.deposit(50_000e18, bob);
        assertEq(vault.totalAssets(), 150_000e18);

        // 3. Alice deposits secondary (5 WETH = 10k DAI value)
        vm.prank(alice);
        uint256 wethShares = vault.depositSecondary(address(weth), 5e18, 0);
        assertGt(wethShares, 0);

        // 4. Total vault value = 150k DAI + 10k WETH value = 160k
        assertEq(vault.totalVaultValue(), 160_000e18);

        // 5. Mature all deposits
        vm.warp(block.timestamp + 30 days);

        // 6. Bob redeems all shares — no fee, but gets proportional PRIMARY assets
        // ERC-4626 redeem uses totalAssets() (primary only = 150k DAI)
        // Bob has 50k shares out of 160k total → gets (50k * 150k) / 160k = 46875 DAI
        uint256 bobShares = vault.balanceOf(bob);
        vm.prank(bob);
        uint256 bobAssets = vault.redeem(bobShares, bob, bob);
        uint256 expectedBobAssets = (bobShares * 150_000e18) / 160_000e18;
        assertEq(bobAssets, expectedBobAssets);

        // 7. Vault is healthy
        assertTrue(vault.isHealthy());
    }

    function test_emergencyLifecycle() public {
        // Deposit and mature
        vm.prank(alice);
        vault.deposit(100_000e18, alice);

        vm.warp(block.timestamp + 30 days);

        // Activate emergency
        vault.activateEmergencyMode();

        // Can't deposit
        vm.prank(bob);
        vm.expectRevert(VibeVault.EmergencyModeActive.selector);
        vault.deposit(50_000e18, bob);

        // Can withdraw (matured → no fee)
        vm.prank(alice);
        vault.redeem(50_000e18, alice, alice);

        // Deactivate emergency
        vault.deactivateEmergencyMode();

        // Can deposit again — share price is 1:1 (no fee residue)
        vm.prank(bob);
        vault.deposit(50_000e18, bob);
        assertEq(vault.balanceOf(bob), 50_000e18);
    }
}
