// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeSynth.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockSynthToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract MockSynthRepOracle {
    mapping(address => uint8) public tiers;
    function setTier(address user, uint8 tier) external { tiers[user] = tier; }
    function getTrustTier(address user) external view returns (uint8) { return tiers[user]; }
    function getTrustScore(address user) external view returns (uint256) { return uint256(tiers[user]) * 25; }
    function isEligible(address user, uint8 requiredTier) external view returns (bool) { return tiers[user] >= requiredTier; }
}

// ============ Tests ============

contract VibeSynthTest is Test {
    VibeSynth public synth;
    MockSynthToken public jul;
    MockSynthToken public usdc;
    MockSynthRepOracle public repOracle;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address keeper = address(0xCC);
    address priceSetter = address(0xDD);
    address owner;

    // Default synth params: vBTC with 150% min C-ratio, 120% liquidation, 10% penalty
    uint16 constant MIN_C_RATIO = 15000;
    uint16 constant LIQ_C_RATIO = 12000;
    uint16 constant LIQ_PENALTY = 1000;
    uint256 constant BTC_PRICE = 50_000e18;

    function setUp() public {
        owner = address(this);
        vm.warp(1000);

        jul = new MockSynthToken("Joule", "JUL");
        usdc = new MockSynthToken("USDC", "USDC");
        repOracle = new MockSynthRepOracle();

        synth = new VibeSynth(address(jul), address(repOracle), address(usdc));

        // Fund users
        usdc.mint(alice, 10_000_000e18);
        usdc.mint(bob, 10_000_000e18);
        jul.mint(owner, 1_000_000e18);

        vm.prank(alice);
        usdc.approve(address(synth), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(synth), type(uint256).max);
        jul.approve(address(synth), type(uint256).max);
    }

    // ============ Helpers ============

    function _registerBTC() internal returns (uint8) {
        return synth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "Synthetic Bitcoin",
            symbol: "vBTC",
            initialPrice: BTC_PRICE,
            minCRatioBps: MIN_C_RATIO,
            liquidationCRatioBps: LIQ_C_RATIO,
            liquidationPenaltyBps: LIQ_PENALTY
        }));
    }

    function _openAndMint(address user, uint256 collateral, uint256 synthAmt)
        internal returns (uint256 posId)
    {
        vm.prank(user);
        posId = synth.openPosition(0, collateral);
        vm.prank(user);
        synth.mintSynth(posId, synthAmt);
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(address(synth.julToken()), address(jul));
        assertEq(address(synth.collateralToken()), address(usdc));
        assertEq(address(synth.reputationOracle()), address(repOracle));
        assertEq(synth.totalPositions(), 0);
        assertEq(synth.totalSynthAssets(), 0);
    }

    function test_revertConstructorZeroAddress() public {
        vm.expectRevert(IVibeSynth.ZeroAddress.selector);
        new VibeSynth(address(0), address(repOracle), address(usdc));

        vm.expectRevert(IVibeSynth.ZeroAddress.selector);
        new VibeSynth(address(jul), address(0), address(usdc));

        vm.expectRevert(IVibeSynth.ZeroAddress.selector);
        new VibeSynth(address(jul), address(repOracle), address(0));
    }

    // ============ Register Synth Asset ============

    function test_registerSynthAsset() public {
        uint8 id = _registerBTC();
        assertEq(id, 0);
        assertEq(synth.totalSynthAssets(), 1);

        IVibeSynth.SynthAsset memory asset = synth.getSynthAsset(0);
        assertEq(asset.currentPrice, BTC_PRICE);
        assertEq(asset.minCRatioBps, MIN_C_RATIO);
        assertEq(asset.liquidationCRatioBps, LIQ_C_RATIO);
        assertEq(asset.liquidationPenaltyBps, LIQ_PENALTY);
        assertTrue(asset.active);
    }

    function test_revertRegisterNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        synth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "vBTC", symbol: "vBTC", initialPrice: BTC_PRICE,
            minCRatioBps: MIN_C_RATIO, liquidationCRatioBps: LIQ_C_RATIO,
            liquidationPenaltyBps: LIQ_PENALTY
        }));
    }

    function test_revertRegisterZeroPrice() public {
        vm.expectRevert(IVibeSynth.InvalidPrice.selector);
        synth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "vBTC", symbol: "vBTC", initialPrice: 0,
            minCRatioBps: MIN_C_RATIO, liquidationCRatioBps: LIQ_C_RATIO,
            liquidationPenaltyBps: LIQ_PENALTY
        }));
    }

    function test_revertRegisterInvalidCRatio() public {
        // minCRatio must be > 10000 (100%)
        vm.expectRevert(IVibeSynth.InvalidCRatio.selector);
        synth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "vBTC", symbol: "vBTC", initialPrice: BTC_PRICE,
            minCRatioBps: 10000, liquidationCRatioBps: 9000,
            liquidationPenaltyBps: LIQ_PENALTY
        }));
    }

    function test_revertRegisterLiqGtMin() public {
        // liquidation must be < minCRatio
        vm.expectRevert(IVibeSynth.InvalidLiquidationParams.selector);
        synth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "vBTC", symbol: "vBTC", initialPrice: BTC_PRICE,
            minCRatioBps: 15000, liquidationCRatioBps: 15000,
            liquidationPenaltyBps: LIQ_PENALTY
        }));
    }

    // ============ Deactivate ============

    function test_deactivateSynthAsset() public {
        _registerBTC();
        synth.deactivateSynthAsset(0);
        assertFalse(synth.getSynthAsset(0).active);
    }

    function test_revertDeactivateInvalid() public {
        vm.expectRevert(IVibeSynth.InvalidSynthAsset.selector);
        synth.deactivateSynthAsset(0);
    }

    // ============ Update Price ============

    function test_updatePrice() public {
        _registerBTC();
        synth.updatePrice(0, 55_000e18);
        assertEq(synth.getSynthAsset(0).currentPrice, 55_000e18);
    }

    function test_updatePriceAuthorizedSetter() public {
        _registerBTC();
        synth.setPriceSetter(priceSetter, true);
        assertTrue(synth.authorizedPriceSetters(priceSetter));

        vm.prank(priceSetter);
        synth.updatePrice(0, 52_000e18);
        assertEq(synth.getSynthAsset(0).currentPrice, 52_000e18);
    }

    function test_revertUpdatePriceUnauthorized() public {
        _registerBTC();
        vm.prank(alice);
        vm.expectRevert(IVibeSynth.NotAuthorizedPriceSetter.selector);
        synth.updatePrice(0, 55_000e18);
    }

    function test_revertUpdatePriceZero() public {
        _registerBTC();
        vm.expectRevert(IVibeSynth.InvalidPrice.selector);
        synth.updatePrice(0, 0);
    }

    function test_priceJumpProtection() public {
        _registerBTC();
        // Default maxPriceJumpBps = 2000 (20%)
        // 50000 * 20% = 10000 → max price is 60000

        synth.setPriceSetter(priceSetter, true);

        // Within 20% → OK
        vm.prank(priceSetter);
        synth.updatePrice(0, 60_000e18);

        // Beyond 20% → revert (from 60000, 20% = 12000, max = 72000)
        vm.prank(priceSetter);
        vm.expectRevert(IVibeSynth.PriceJumpExceeded.selector);
        synth.updatePrice(0, 80_000e18);

        // Owner bypasses jump limit
        synth.updatePrice(0, 100_000e18);
        assertEq(synth.getSynthAsset(0).currentPrice, 100_000e18);
    }

    function test_setMaxPriceJump() public {
        synth.setMaxPriceJump(3000);
        assertEq(synth.maxPriceJumpBps(), 3000);
    }

    function test_revertSetMaxPriceJumpTooHigh() public {
        vm.expectRevert(IVibeSynth.InvalidJumpLimit.selector);
        synth.setMaxPriceJump(5001);
    }

    // ============ Open Position ============

    function test_openPosition() public {
        _registerBTC();
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 100_000e18);

        assertEq(posId, 1);
        assertEq(synth.totalPositions(), 1);
        assertEq(synth.ownerOf(posId), alice);

        IVibeSynth.SynthPosition memory pos = synth.getPosition(posId);
        assertEq(pos.minter, alice);
        assertEq(pos.collateralAmount, 100_000e18);
        assertEq(pos.mintedAmount, 0);
        assertTrue(pos.state == IVibeSynth.PositionState.ACTIVE);
    }

    function test_revertOpenPositionInactive() public {
        _registerBTC();
        synth.deactivateSynthAsset(0);
        vm.prank(alice);
        vm.expectRevert(IVibeSynth.SynthAssetNotActive.selector);
        synth.openPosition(0, 100_000e18);
    }

    function test_revertOpenPositionZero() public {
        _registerBTC();
        vm.prank(alice);
        vm.expectRevert(IVibeSynth.ZeroAmount.selector);
        synth.openPosition(0, 0);
    }

    // ============ Mint Synth ============

    function test_mintSynth() public {
        _registerBTC();
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 100_000e18);

        // Mint 1 vBTC: debt = 1 * 50000 = 50000, need 50000 * 1.5 = 75000 collateral
        // Alice has 100000 → OK
        vm.prank(alice);
        synth.mintSynth(posId, 1e18);

        IVibeSynth.SynthPosition memory pos = synth.getPosition(posId);
        assertEq(pos.mintedAmount, 1e18);
        assertEq(synth.getSynthAsset(0).totalMinted, 1e18);
    }

    function test_revertMintBelowCRatio() public {
        _registerBTC();
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 100_000e18);

        // Mint 2 vBTC: debt = 2 * 50000 = 100000, need 100000 * 1.5 = 150000
        // Alice only has 100000 → revert
        vm.prank(alice);
        vm.expectRevert(IVibeSynth.BelowMinCRatio.selector);
        synth.mintSynth(posId, 2e18);
    }

    function test_revertMintNotOwner() public {
        _registerBTC();
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 100_000e18);

        vm.prank(bob);
        vm.expectRevert(IVibeSynth.NotPositionOwner.selector);
        synth.mintSynth(posId, 1e18);
    }

    // ============ Burn Synth ============

    function test_burnSynth() public {
        _registerBTC();
        uint256 posId = _openAndMint(alice, 100_000e18, 1e18);

        vm.prank(alice);
        synth.burnSynth(posId, 0.5e18);

        assertEq(synth.getPosition(posId).mintedAmount, 0.5e18);
    }

    function test_revertBurnExceedsMinted() public {
        _registerBTC();
        uint256 posId = _openAndMint(alice, 100_000e18, 1e18);

        vm.prank(alice);
        vm.expectRevert(IVibeSynth.ExceedsMintedAmount.selector);
        synth.burnSynth(posId, 2e18);
    }

    // ============ Add/Withdraw Collateral ============

    function test_addCollateral() public {
        _registerBTC();
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 50_000e18);

        vm.prank(alice);
        synth.addCollateral(posId, 25_000e18);

        assertEq(synth.getPosition(posId).collateralAmount, 75_000e18);
    }

    function test_withdrawCollateral() public {
        _registerBTC();
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 100_000e18);

        // No debt → can withdraw freely
        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        synth.withdrawCollateral(posId, 50_000e18);

        assertEq(synth.getPosition(posId).collateralAmount, 50_000e18);
        assertEq(usdc.balanceOf(alice), balBefore + 50_000e18);
    }

    function test_revertWithdrawBelowCRatio() public {
        _registerBTC();
        uint256 posId = _openAndMint(alice, 100_000e18, 1e18);

        // Debt = 50000, min collateral = 50000 * 1.5 = 75000
        // Withdrawing 30000 leaves 70000 < 75000 → revert
        vm.prank(alice);
        vm.expectRevert(IVibeSynth.BelowMinCRatio.selector);
        synth.withdrawCollateral(posId, 30_000e18);
    }

    function test_withdrawCollateralWithDebt() public {
        _registerBTC();
        uint256 posId = _openAndMint(alice, 100_000e18, 1e18);

        // Debt = 50000, min collateral = 75000
        // Withdraw 25000 → leaves 75000 = exactly at limit → OK
        vm.prank(alice);
        synth.withdrawCollateral(posId, 25_000e18);
        assertEq(synth.getPosition(posId).collateralAmount, 75_000e18);
    }

    function test_revertWithdrawNotOwner() public {
        _registerBTC();
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 100_000e18);

        vm.prank(bob);
        vm.expectRevert(IVibeSynth.NotPositionOwner.selector);
        synth.withdrawCollateral(posId, 10_000e18);
    }

    // ============ Close Position ============

    function test_closePosition() public {
        _registerBTC();
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 100_000e18);

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        synth.closePosition(posId);

        assertEq(usdc.balanceOf(alice), balBefore + 100_000e18);
        assertTrue(synth.getPosition(posId).state == IVibeSynth.PositionState.CLOSED);
    }

    function test_revertCloseWithDebt() public {
        _registerBTC();
        uint256 posId = _openAndMint(alice, 100_000e18, 1e18);

        vm.prank(alice);
        vm.expectRevert(IVibeSynth.HasOutstandingDebt.selector);
        synth.closePosition(posId);
    }

    function test_revertCloseNotOwner() public {
        _registerBTC();
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 100_000e18);

        vm.prank(bob);
        vm.expectRevert(IVibeSynth.NotPositionOwner.selector);
        synth.closePosition(posId);
    }

    // ============ Collateral Ratio ============

    function test_collateralRatioNoDebt() public {
        _registerBTC();
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 100_000e18);

        assertEq(synth.collateralRatio(posId), type(uint256).max);
    }

    function test_collateralRatioWithDebt() public {
        _registerBTC();
        uint256 posId = _openAndMint(alice, 100_000e18, 1e18);

        // collateral = 100000, debt = 1 * 50000 = 50000
        // C-ratio = 100000 * 10000 / 50000 = 20000 (200%)
        assertEq(synth.collateralRatio(posId), 20000);
    }

    // ============ Reputation-Gated C-Ratio ============

    function test_effectiveMinCRatioTier0() public {
        _registerBTC();
        // Tier 0: no reduction → 15000 (150%)
        assertEq(synth.effectiveMinCRatio(0, alice), 15000);
    }

    function test_effectiveMinCRatioTier2() public {
        _registerBTC();
        repOracle.setTier(alice, 2);
        // Tier 2: -1000 bps → 15000 - 1000 = 14000 (140%)
        assertEq(synth.effectiveMinCRatio(0, alice), 14000);
    }

    function test_effectiveMinCRatioTier4() public {
        _registerBTC();
        repOracle.setTier(alice, 4);
        // Tier 4: -2000 bps → 15000 - 2000 = 13000 (130%)
        assertEq(synth.effectiveMinCRatio(0, alice), 13000);
    }

    function test_effectiveMinCRatioFloorAtLiquidation() public {
        _registerBTC();
        // Register asset with low minCRatio so reduction would go below liquidation
        synth.registerSynthAsset(IVibeSynth.RegisterSynthParams({
            name: "vETH", symbol: "vETH", initialPrice: 3000e18,
            minCRatioBps: 13000, // 130%
            liquidationCRatioBps: 12000, // 120%
            liquidationPenaltyBps: 500
        }));
        repOracle.setTier(alice, 4);
        // Tier 4 reduction = 2000: 13000 - 2000 = 11000 < 12000 → floored at 12000
        assertEq(synth.effectiveMinCRatio(1, alice), 12000);
    }

    function test_reputationAllowsMoreLeverage() public {
        _registerBTC();
        repOracle.setTier(alice, 4);

        // Tier 4 → effective minCR = 13000 (130%)
        // With 100000 collateral, max debt = 100000 / 1.3 = 76923
        // Max vBTC = 76923 / 50000 = ~1.538
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 100_000e18);

        // Mint 1.5 vBTC: debt = 75000, needed = 75000 * 1.3 = 97500 < 100000 → OK
        vm.prank(alice);
        synth.mintSynth(posId, 1.5e18);

        assertEq(synth.getPosition(posId).mintedAmount, 1.5e18);
    }

    // ============ Liquidation ============

    function test_isLiquidatable() public {
        _registerBTC();
        uint256 posId = _openAndMint(alice, 100_000e18, 1e18);

        // C-ratio = 200% > 120% → not liquidatable
        assertFalse(synth.isLiquidatable(posId));

        // Price rises to 90000 → debt = 90000
        // C-ratio = 100000 * 10000 / 90000 = 11111 < 12000 → liquidatable
        synth.updatePrice(0, 90_000e18);
        assertTrue(synth.isLiquidatable(posId));
    }

    function test_liquidate() public {
        _registerBTC();
        uint256 posId = _openAndMint(alice, 100_000e18, 1e18);

        // Fund JUL rewards
        synth.depositJulRewards(100e18);

        // Price rises to 90000 → liquidatable
        synth.updatePrice(0, 90_000e18);

        uint256 keeperJulBefore = jul.balanceOf(keeper);
        vm.prank(keeper);
        synth.liquidate(posId);

        IVibeSynth.SynthPosition memory pos = synth.getPosition(posId);
        assertTrue(pos.state == IVibeSynth.PositionState.LIQUIDATED);
        assertEq(pos.mintedAmount, 0);
        assertEq(pos.collateralAmount, 0);

        // Keeper got JUL tip
        assertEq(jul.balanceOf(keeper) - keeperJulBefore, 10e18);

        // Protocol revenue increased
        assertGt(synth.protocolRevenue(), 0);
    }

    function test_liquidateReturnsExcess() public {
        _registerBTC();
        uint256 posId = _openAndMint(alice, 100_000e18, 1e18);

        // Price rises just enough: 85000
        // debt = 85000, penalty = 85000 * 10% = 8500
        // total seized = 93500, excess = 100000 - 93500 = 6500
        synth.updatePrice(0, 85_000e18);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(keeper);
        synth.liquidate(posId);

        uint256 aliceAfter = usdc.balanceOf(alice);
        assertEq(aliceAfter - aliceBefore, 6500e18);
    }

    function test_revertLiquidateNotLiquidatable() public {
        _registerBTC();
        uint256 posId = _openAndMint(alice, 100_000e18, 1e18);

        vm.prank(keeper);
        vm.expectRevert(IVibeSynth.NotLiquidatable.selector);
        synth.liquidate(posId);
    }

    // ============ JUL Rewards ============

    function test_depositJulRewards() public {
        synth.depositJulRewards(500e18);
        assertEq(synth.julRewardPool(), 500e18);
    }

    function test_revertDepositJulZero() public {
        vm.expectRevert(IVibeSynth.ZeroAmount.selector);
        synth.depositJulRewards(0);
    }

    // ============ Protocol Revenue ============

    function test_withdrawProtocolRevenue() public {
        _registerBTC();
        uint256 posId = _openAndMint(alice, 100_000e18, 1e18);

        // Liquidate to generate protocol revenue
        synth.updatePrice(0, 90_000e18);
        vm.prank(keeper);
        synth.liquidate(posId);

        uint256 revenue = synth.protocolRevenue();
        assertGt(revenue, 0);

        uint256 ownerBal = usdc.balanceOf(owner);
        synth.withdrawProtocolRevenue(revenue);
        assertEq(usdc.balanceOf(owner), ownerBal + revenue);
        assertEq(synth.protocolRevenue(), 0);
    }

    // ============ NFT Transfer ============

    function test_nftTransferUpdatesMinter() public {
        _registerBTC();
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 100_000e18);

        // Transfer NFT to Bob
        vm.prank(alice);
        synth.transferFrom(alice, bob, posId);

        assertEq(synth.ownerOf(posId), bob);
        assertEq(synth.getPosition(posId).minter, bob);
    }

    // ============ Price Setter Admin ============

    function test_setPriceSetterAndRevoke() public {
        synth.setPriceSetter(priceSetter, true);
        assertTrue(synth.authorizedPriceSetters(priceSetter));

        synth.setPriceSetter(priceSetter, false);
        assertFalse(synth.authorizedPriceSetters(priceSetter));
    }

    function test_revertSetPriceSetterZero() public {
        vm.expectRevert(IVibeSynth.ZeroAddress.selector);
        synth.setPriceSetter(address(0), true);
    }

    // ============ Full Lifecycle ============

    function test_fullLifecycle() public {
        // 1. Register vBTC
        _registerBTC();

        // 2. Alice opens position with 100k USDC
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 100_000e18);

        // 3. Alice mints 1 vBTC (debt = 50k, C-ratio = 200%)
        vm.prank(alice);
        synth.mintSynth(posId, 1e18);
        assertEq(synth.collateralRatio(posId), 20000);

        // 4. Price rises to 55k (debt = 55k, C-ratio = ~181%)
        synth.updatePrice(0, 55_000e18);
        assertEq(synth.collateralRatio(posId), 18181);

        // 5. Alice adds collateral to improve ratio
        vm.prank(alice);
        synth.addCollateral(posId, 20_000e18);
        // C-ratio = 120000 * 10000 / 55000 = 21818
        assertEq(synth.collateralRatio(posId), 21818);

        // 6. Alice burns 0.5 vBTC (reduces debt)
        vm.prank(alice);
        synth.burnSynth(posId, 0.5e18);
        // Debt now = 0.5 * 55000 = 27500
        // C-ratio = 120000 * 10000 / 27500 = 43636
        assertEq(synth.collateralRatio(posId), 43636);

        // 7. Alice burns remaining 0.5 vBTC
        vm.prank(alice);
        synth.burnSynth(posId, 0.5e18);
        assertEq(synth.collateralRatio(posId), type(uint256).max);

        // 8. Alice closes position and gets all collateral back
        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        synth.closePosition(posId);
        assertEq(usdc.balanceOf(alice), balBefore + 120_000e18);
    }

    function test_liquidationLifecycle() public {
        // 1. Setup
        _registerBTC();
        synth.depositJulRewards(100e18);

        // 2. Alice opens + mints near max leverage
        vm.prank(alice);
        uint256 posId = synth.openPosition(0, 80_000e18);
        vm.prank(alice);
        synth.mintSynth(posId, 1e18);
        // debt = 50000, C-ratio = 80000*10000/50000 = 16000 (160%)

        // 3. Price jumps to 70000
        synth.updatePrice(0, 60_000e18);
        synth.updatePrice(0, 70_000e18);
        // debt = 70000, C-ratio = 80000*10000/70000 = 11428 < 12000 → liquidatable

        assertTrue(synth.isLiquidatable(posId));

        // 4. Keeper liquidates
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(keeper);
        synth.liquidate(posId);

        // Verify state
        IVibeSynth.SynthPosition memory pos = synth.getPosition(posId);
        assertTrue(pos.state == IVibeSynth.PositionState.LIQUIDATED);

        // Alice got excess collateral back
        // seized = min(80000, 70000 + 7000) = 77000
        // returned = 80000 - 77000 = 3000
        uint256 aliceAfter = usdc.balanceOf(alice);
        assertEq(aliceAfter - aliceBefore, 3000e18);

        // Protocol revenue = 77000
        assertEq(synth.protocolRevenue(), 77_000e18);

        // Keeper got JUL
        assertEq(jul.balanceOf(keeper), 10e18);
    }

    // ERC-721 receiver
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
