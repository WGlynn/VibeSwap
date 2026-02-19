// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/LiquidityProtection.sol";

contract LiqProtWrapper {
    function calculateVirtualReserves(uint256 r0, uint256 r1, uint256 amp)
        external pure returns (uint256, uint256)
    {
        return LiquidityProtection.calculateVirtualReserves(r0, r1, amp);
    }

    function getAmountOutWithVirtualReserves(
        uint256 amountIn, uint256 rIn, uint256 rOut, uint256 amp, uint256 fee
    ) external pure returns (uint256) {
        return LiquidityProtection.getAmountOutWithVirtualReserves(amountIn, rIn, rOut, amp, fee);
    }

    function calculateDynamicFee(uint256 liq, uint256 vol, uint256 baseFee)
        external pure returns (uint256)
    {
        return LiquidityProtection.calculateDynamicFee(liq, vol, baseFee);
    }

    function getRecommendedFee(bool stable, uint256 vol24h, uint256 liq)
        external pure returns (uint256)
    {
        return LiquidityProtection.getRecommendedFee(stable, vol24h, liq);
    }

    function calculatePriceImpact(uint256 amountIn, uint256 rIn, uint256 rOut)
        external pure returns (uint256)
    {
        return LiquidityProtection.calculatePriceImpact(amountIn, rIn, rOut);
    }

    function requirePriceImpactWithinBounds(uint256 amountIn, uint256 rIn, uint256 rOut, uint256 maxBps)
        external pure
    {
        LiquidityProtection.requirePriceImpactWithinBounds(amountIn, rIn, rOut, maxBps);
    }

    function getMaxTradeSize(uint256 rIn, uint256 maxBps) external pure returns (uint256) {
        return LiquidityProtection.getMaxTradeSize(rIn, maxBps);
    }

    function requireMinimumLiquidity(uint256 liq, uint256 min) external pure {
        LiquidityProtection.requireMinimumLiquidity(liq, min);
    }

    function calculateLiquidityScore(LiquidityProtection.LiquidityMetrics memory m)
        external pure returns (uint256)
    {
        return LiquidityProtection.calculateLiquidityScore(m);
    }

    function getDefaultConfig() external pure returns (LiquidityProtection.ProtectionConfig memory) {
        return LiquidityProtection.getDefaultConfig();
    }

    function getStablePairConfig() external pure returns (LiquidityProtection.ProtectionConfig memory) {
        return LiquidityProtection.getStablePairConfig();
    }

    function validateConfig(LiquidityProtection.ProtectionConfig memory config) external pure {
        LiquidityProtection.validateConfig(config);
    }

    function applyProtections(
        LiquidityProtection.ProtectionConfig memory config,
        LiquidityProtection.LiquidityMetrics memory metrics,
        uint256 amountIn,
        uint256 tradeValueUsd
    ) external pure returns (uint256, uint256, uint256) {
        return LiquidityProtection.applyProtections(config, metrics, amountIn, tradeValueUsd);
    }
}

contract LiquidityProtectionTest is Test {
    LiqProtWrapper lib;
    uint256 constant PRECISION = 1e18;

    function setUp() public {
        lib = new LiqProtWrapper();
    }

    // ============ Virtual Reserves ============

    function test_virtualReserves_basic() public view {
        (uint256 e0, uint256 e1) = lib.calculateVirtualReserves(100e18, 200e18, 10);
        assertEq(e0, 1000e18);
        assertEq(e1, 2000e18);
    }

    function test_virtualReserves_noAmplification() public view {
        (uint256 e0, uint256 e1) = lib.calculateVirtualReserves(100e18, 100e18, 1);
        assertEq(e0, 100e18);
        assertEq(e1, 100e18);
    }

    function test_virtualReserves_revertsInvalidAmp() public {
        vm.expectRevert(abi.encodeWithSelector(LiquidityProtection.InvalidAmplification.selector, 0));
        lib.calculateVirtualReserves(100e18, 100e18, 0);

        vm.expectRevert(abi.encodeWithSelector(LiquidityProtection.InvalidAmplification.selector, 1001));
        lib.calculateVirtualReserves(100e18, 100e18, 1001);
    }

    // ============ getAmountOutWithVirtualReserves ============

    function test_virtualAmountOut_zeroInput() public view {
        assertEq(lib.getAmountOutWithVirtualReserves(0, 100e18, 100e18, 10, 30), 0);
    }

    function test_virtualAmountOut_zeroReserves() public view {
        assertEq(lib.getAmountOutWithVirtualReserves(1e18, 0, 100e18, 10, 30), 0);
        assertEq(lib.getAmountOutWithVirtualReserves(1e18, 100e18, 0, 10, 30), 0);
    }

    function test_virtualAmountOut_higherAmpReducesImpact() public view {
        uint256 out1 = lib.getAmountOutWithVirtualReserves(10e18, 100e18, 100e18, 1, 30);
        uint256 out10 = lib.getAmountOutWithVirtualReserves(10e18, 100e18, 100e18, 10, 30);
        // Higher amplification → less price impact → more output
        assertGt(out10, out1);
    }

    // ============ Dynamic Fees ============

    function test_dynamicFee_aboveThreshold() public view {
        // Liquidity >= LOW_LIQUIDITY_THRESHOLD ($100k) → base fee
        uint256 fee = lib.calculateDynamicFee(100_000e18, 1000e18, 30);
        assertEq(fee, 30);
    }

    function test_dynamicFee_zeroLiquidity() public view {
        assertEq(lib.calculateDynamicFee(0, 1000e18, 30), 500); // MAX_FEE_BPS
    }

    function test_dynamicFee_lowLiquidity() public view {
        // $50k liquidity → threshold/liq = 2x → fee = 60
        uint256 fee = lib.calculateDynamicFee(50_000e18, 0, 30);
        assertEq(fee, 60);
    }

    function test_dynamicFee_veryLowLiquidity() public view {
        // $10k liquidity → 10x → fee = 300
        uint256 fee = lib.calculateDynamicFee(10_000e18, 0, 30);
        assertEq(fee, 300);
    }

    function test_dynamicFee_capAtMax() public view {
        // Extremely low liquidity caps at MAX_FEE_BPS (500)
        uint256 fee = lib.calculateDynamicFee(1000e18, 10_000e18, 30);
        assertLe(fee, 500);
    }

    // ============ Recommended Fee ============

    function test_recommendedFee_stablePair() public view {
        assertEq(lib.getRecommendedFee(true, 0, 1_000_000e18), 5);
    }

    function test_recommendedFee_lowVol() public view {
        // < 2% volatility, good liquidity
        assertEq(lib.getRecommendedFee(false, 1e16, 1_000_000e18), 30);
    }

    function test_recommendedFee_midVol() public view {
        // 3% volatility
        assertEq(lib.getRecommendedFee(false, 3e16, 1_000_000e18), 50);
    }

    function test_recommendedFee_highVol() public view {
        // 10% volatility
        assertEq(lib.getRecommendedFee(false, 10e16, 1_000_000e18), 100);
    }

    // ============ Price Impact ============

    function test_priceImpact_basic() public view {
        // 10 into 100 → impact = 10/(100+10) = 909 bps
        uint256 impact = lib.calculatePriceImpact(10e18, 100e18, 100e18);
        assertEq(impact, 909); // 10000 * 10 / 110 = 909
    }

    function test_priceImpact_zeroInput() public view {
        assertEq(lib.calculatePriceImpact(0, 100e18, 100e18), 0);
    }

    function test_priceImpact_zeroReserve() public view {
        assertEq(lib.calculatePriceImpact(10e18, 0, 100e18), 0);
    }

    function test_priceImpact_small() public view {
        // 0.1% of reserves → ~10 bps impact
        uint256 impact = lib.calculatePriceImpact(0.1e18, 100e18, 100e18);
        assertLe(impact, 10);
    }

    function test_requirePriceImpact_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(
            LiquidityProtection.PriceImpactTooHigh.selector, 909, 500
        ));
        lib.requirePriceImpactWithinBounds(10e18, 100e18, 100e18, 500);
    }

    // ============ Max Trade Size ============

    function test_maxTradeSize_300bps() public view {
        // 3% impact → amountIn = 300 * reserve / (10000 - 300) = 300/9700 * reserve
        uint256 maxSize = lib.getMaxTradeSize(100e18, 300);
        assertEq(maxSize, (uint256(300) * 100e18) / 9700);
    }

    function test_maxTradeSize_fullBps() public view {
        // 100% → max uint
        assertEq(lib.getMaxTradeSize(100e18, 10000), type(uint256).max);
    }

    // ============ Minimum Liquidity ============

    function test_requireMinLiquidity_passes() public view {
        lib.requireMinimumLiquidity(100_000e18, 10_000e18);
    }

    function test_requireMinLiquidity_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(
            LiquidityProtection.InsufficientLiquidity.selector, 5_000e18, 10_000e18
        ));
        lib.requireMinimumLiquidity(5_000e18, 10_000e18);
    }

    // ============ Liquidity Score ============

    function test_liquidityScore_highLiquidity() public view {
        LiquidityProtection.LiquidityMetrics memory m = LiquidityProtection.LiquidityMetrics({
            reserve0: 5_000_000e18,
            reserve1: 5_000_000e18,
            totalValueUsd: 10_000_000e18,
            concentrationScore: 80,
            utilizationRate: 0.05e18
        });
        uint256 score = lib.calculateLiquidityScore(m);
        // 40 (liq) + 24 (concentration: 80*30/100) + 30 (low util) = 94
        assertEq(score, 94);
    }

    function test_liquidityScore_lowLiquidity() public view {
        LiquidityProtection.LiquidityMetrics memory m = LiquidityProtection.LiquidityMetrics({
            reserve0: 2_500e18,
            reserve1: 2_500e18,
            totalValueUsd: 5_000e18,
            concentrationScore: 30,
            utilizationRate: 0.6e18
        });
        uint256 score = lib.calculateLiquidityScore(m);
        // 0 (liq < $10k) + 9 (30*30/100) + 0 (util >= 50%) = 9
        assertEq(score, 9);
    }

    // ============ Configs ============

    function test_defaultConfig() public view {
        LiquidityProtection.ProtectionConfig memory c = lib.getDefaultConfig();
        assertEq(c.amplificationFactor, 100);
        assertEq(c.maxPriceImpactBps, 300);
        assertTrue(c.virtualReservesEnabled);
        assertTrue(c.dynamicFeesEnabled);
    }

    function test_stablePairConfig() public view {
        LiquidityProtection.ProtectionConfig memory c = lib.getStablePairConfig();
        assertEq(c.amplificationFactor, 500);
        assertEq(c.maxPriceImpactBps, 50);
    }

    function test_validateConfig_reverts_invalidAmp() public {
        LiquidityProtection.ProtectionConfig memory c = lib.getDefaultConfig();
        c.amplificationFactor = 1001;
        vm.expectRevert(LiquidityProtection.InvalidConfiguration.selector);
        lib.validateConfig(c);
    }

    function test_validateConfig_reverts_invalidImpact() public {
        LiquidityProtection.ProtectionConfig memory c = lib.getDefaultConfig();
        c.maxPriceImpactBps = 1001; // > ABSOLUTE_MAX_IMPACT_BPS (1000)
        vm.expectRevert(LiquidityProtection.InvalidConfiguration.selector);
        lib.validateConfig(c);
    }

    // ============ applyProtections (composite) ============

    function test_applyProtections_allEnabled() public view {
        LiquidityProtection.ProtectionConfig memory config = lib.getDefaultConfig();
        LiquidityProtection.LiquidityMetrics memory metrics = LiquidityProtection.LiquidityMetrics({
            reserve0: 1_000_000e18,
            reserve1: 1_000_000e18,
            totalValueUsd: 2_000_000e18,
            concentrationScore: 50,
            utilizationRate: 0.1e18
        });

        (uint256 fee, uint256 eff0, uint256 eff1) = lib.applyProtections(
            config, metrics, 1e18, 1000e18
        );

        // Virtual reserves: 1M * 100 = 100M
        assertEq(eff0, 100_000_000e18);
        assertEq(eff1, 100_000_000e18);
        // Dynamic fee: liquidity above threshold → base fee (30)
        assertEq(fee, 30);
    }

    function test_applyProtections_gateReverts() public {
        LiquidityProtection.ProtectionConfig memory config = lib.getDefaultConfig();
        LiquidityProtection.LiquidityMetrics memory metrics = LiquidityProtection.LiquidityMetrics({
            reserve0: 1000e18,
            reserve1: 1000e18,
            totalValueUsd: 2000e18, // Below minimum ($10k)
            concentrationScore: 50,
            utilizationRate: 0.1e18
        });

        vm.expectRevert(abi.encodeWithSelector(
            LiquidityProtection.InsufficientLiquidity.selector, 2000e18, 10_000e18
        ));
        lib.applyProtections(config, metrics, 1e18, 100e18);
    }
}
