// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/LiquidityProtection.sol";
import "../../contracts/libraries/VWAPOracle.sol";

/**
 * @title LiquidityProtectionTest
 * @notice Tests for liquidity protection mechanisms with formal invariant verification
 */
contract LiquidityProtectionTest is Test {
    uint256 constant PRECISION = 1e18;
    uint256 constant BPS = 10000;

    // ============ Virtual Reserves Tests ============

    function test_virtualReserves_basic() public pure {
        (uint256 eff0, uint256 eff1) = LiquidityProtection.calculateVirtualReserves(
            100 ether,
            100 ether,
            100 // 100x amplification
        );

        assertEq(eff0, 10000 ether);
        assertEq(eff1, 10000 ether);
    }

    function test_virtualReserves_minAmplification() public pure {
        (uint256 eff0, uint256 eff1) = LiquidityProtection.calculateVirtualReserves(
            100 ether,
            100 ether,
            1 // No amplification
        );

        assertEq(eff0, 100 ether);
        assertEq(eff1, 100 ether);
    }

    function test_virtualReserves_invalidAmplification() public {
        vm.expectRevert(
            abi.encodeWithSelector(LiquidityProtection.InvalidAmplification.selector, 0)
        );
        LiquidityProtection.calculateVirtualReserves(100 ether, 100 ether, 0);

        vm.expectRevert(
            abi.encodeWithSelector(LiquidityProtection.InvalidAmplification.selector, 1001)
        );
        LiquidityProtection.calculateVirtualReserves(100 ether, 100 ether, 1001);
    }

    /**
     * @notice INV1: Virtual reserves only reduce price impact
     * @dev Fuzz test proving impact_virtual ≤ impact_actual for all inputs
     */
    function testFuzz_INV1_virtualReservesReduceImpact(
        uint128 reserve,
        uint128 amountIn,
        uint16 amplification
    ) public pure {
        vm.assume(reserve > 1 ether);
        vm.assume(amountIn > 0 && amountIn < reserve);
        vm.assume(amplification >= 1 && amplification <= 1000);

        // Calculate impact with actual reserves
        uint256 impactActual = LiquidityProtection.calculatePriceImpact(
            amountIn,
            reserve,
            reserve
        );

        // Calculate impact with virtual reserves
        (uint256 virtualReserve, ) = LiquidityProtection.calculateVirtualReserves(
            reserve,
            reserve,
            amplification
        );
        uint256 impactVirtual = LiquidityProtection.calculatePriceImpact(
            amountIn,
            virtualReserve,
            virtualReserve
        );

        // INV1: Virtual impact should always be <= actual impact
        assertLe(impactVirtual, impactActual, "INV1 violated: virtual impact > actual impact");
    }

    // ============ Dynamic Fees Tests ============

    function test_dynamicFee_aboveThreshold() public pure {
        // Liquidity above threshold should return base fee
        uint256 fee = LiquidityProtection.calculateDynamicFee(
            200_000 * PRECISION, // $200k liquidity
            1000 * PRECISION,    // $1k trade
            30                   // 0.3% base
        );

        assertEq(fee, 30);
    }

    function test_dynamicFee_belowThreshold() public pure {
        // Liquidity below threshold should increase fee
        uint256 fee = LiquidityProtection.calculateDynamicFee(
            50_000 * PRECISION,  // $50k liquidity (half threshold)
            1000 * PRECISION,    // $1k trade
            30                   // 0.3% base
        );

        // Fee should be ~2x base (threshold/liquidity = 2)
        assertEq(fee, 60);
    }

    function test_dynamicFee_veryLowLiquidity() public pure {
        // Very low liquidity should cap at max fee
        uint256 fee = LiquidityProtection.calculateDynamicFee(
            1000 * PRECISION,    // $1k liquidity
            100 * PRECISION,     // $100 trade
            30                   // 0.3% base
        );

        assertEq(fee, 500); // Max fee cap
    }

    function test_dynamicFee_zeroLiquidity() public pure {
        uint256 fee = LiquidityProtection.calculateDynamicFee(
            0,
            100 * PRECISION,
            30
        );

        assertEq(fee, 500); // Max fee
    }

    function test_dynamicFee_largeTradeInLowLiquidity() public pure {
        // Large trade relative to liquidity should add penalty
        uint256 fee = LiquidityProtection.calculateDynamicFee(
            50_000 * PRECISION,  // $50k liquidity
            10_000 * PRECISION,  // $10k trade (20% of liquidity)
            30
        );

        // Base scaling: 60 + volume penalty
        assertGt(fee, 60);
        assertLe(fee, 500); // Still capped
    }

    /**
     * @notice INV2: Dynamic fees monotonically increase as liquidity decreases
     */
    function testFuzz_INV2_feesIncreaseWithLowerLiquidity(
        uint128 liquidityHigh,
        uint128 liquidityLow
    ) public pure {
        vm.assume(liquidityHigh > liquidityLow);
        vm.assume(liquidityLow > 0);

        uint256 feeHigh = LiquidityProtection.calculateDynamicFee(
            liquidityHigh,
            1000 * PRECISION,
            30
        );

        uint256 feeLow = LiquidityProtection.calculateDynamicFee(
            liquidityLow,
            1000 * PRECISION,
            30
        );

        // INV2: Lower liquidity → higher or equal fee
        assertGe(feeLow, feeHigh, "INV2 violated: fee decreased with lower liquidity");
    }

    // ============ Price Impact Tests ============

    function test_priceImpact_small() public pure {
        // Small trade relative to reserves
        uint256 impact = LiquidityProtection.calculatePriceImpact(
            1 ether,      // 1 ETH trade
            1000 ether,   // 1000 ETH reserve
            1000 ether
        );

        // ~0.1% impact
        assertApproxEqAbs(impact, 10, 1); // ~10 bps
    }

    function test_priceImpact_large() public pure {
        // Large trade relative to reserves
        uint256 impact = LiquidityProtection.calculatePriceImpact(
            100 ether,    // 100 ETH trade
            1000 ether,   // 1000 ETH reserve
            1000 ether
        );

        // ~9.09% impact
        assertApproxEqAbs(impact, 909, 5); // ~909 bps
    }

    function test_priceImpact_formula() public pure {
        // Verify formula: impact = amountIn / (reserveIn + amountIn)
        uint256 amountIn = 50 ether;
        uint256 reserveIn = 200 ether;

        uint256 impact = LiquidityProtection.calculatePriceImpact(
            amountIn,
            reserveIn,
            reserveIn
        );

        // Expected: 50 / 250 = 0.2 = 2000 bps
        assertEq(impact, 2000);
    }

    function test_priceImpactCap_pass() public pure {
        // Should not revert when within bounds
        LiquidityProtection.requirePriceImpactWithinBounds(
            10 ether,
            1000 ether,
            1000 ether,
            300 // 3% max
        );
    }

    function test_priceImpactCap_fail() public {
        // Should revert when exceeding cap
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityProtection.PriceImpactTooHigh.selector,
                909, // actual impact
                300  // max allowed
            )
        );
        LiquidityProtection.requirePriceImpactWithinBounds(
            100 ether,
            1000 ether,
            1000 ether,
            300 // 3% max
        );
    }

    /**
     * @notice INV3: Price impact cap provides hard upper bound
     */
    function testFuzz_INV3_priceImpactCapEnforced(
        uint128 amountIn,
        uint128 reserveIn,
        uint16 maxImpactBps
    ) public {
        vm.assume(reserveIn > 0);
        vm.assume(amountIn > 0);
        vm.assume(maxImpactBps > 0 && maxImpactBps < BPS);

        uint256 actualImpact = LiquidityProtection.calculatePriceImpact(
            amountIn,
            reserveIn,
            reserveIn
        );

        if (actualImpact > maxImpactBps) {
            // Should revert
            vm.expectRevert();
            LiquidityProtection.requirePriceImpactWithinBounds(
                amountIn,
                reserveIn,
                reserveIn,
                maxImpactBps
            );
        } else {
            // Should pass
            LiquidityProtection.requirePriceImpactWithinBounds(
                amountIn,
                reserveIn,
                reserveIn,
                maxImpactBps
            );
        }
    }

    function test_getMaxTradeSize() public pure {
        uint256 maxTrade = LiquidityProtection.getMaxTradeSize(
            1000 ether, // reserve
            300         // 3% max impact
        );

        // Verify the calculated max actually results in 3% impact
        uint256 impact = LiquidityProtection.calculatePriceImpact(
            maxTrade,
            1000 ether,
            1000 ether
        );

        assertApproxEqAbs(impact, 300, 1);
    }

    // ============ Minimum Liquidity Gate Tests ============

    function test_minLiquidity_pass() public pure {
        LiquidityProtection.requireMinimumLiquidity(
            100_000 * PRECISION,
            10_000 * PRECISION
        );
    }

    function test_minLiquidity_fail() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityProtection.InsufficientLiquidity.selector,
                5_000 * PRECISION,
                10_000 * PRECISION
            )
        );
        LiquidityProtection.requireMinimumLiquidity(
            5_000 * PRECISION,
            10_000 * PRECISION
        );
    }

    /**
     * @notice INV4: Minimum liquidity gate prevents thin market trading
     */
    function testFuzz_INV4_minLiquidityEnforced(
        uint128 liquidity,
        uint128 minimum
    ) public {
        if (liquidity < minimum) {
            vm.expectRevert();
            LiquidityProtection.requireMinimumLiquidity(liquidity, minimum);
        } else {
            LiquidityProtection.requireMinimumLiquidity(liquidity, minimum);
        }
    }

    // ============ Liquidity Score Tests ============

    function test_liquidityScore_high() public pure {
        LiquidityProtection.LiquidityMetrics memory metrics = LiquidityProtection.LiquidityMetrics({
            reserve0: 1000 ether,
            reserve1: 10_000_000 * PRECISION,
            totalValueUsd: 10_000_000 * PRECISION, // $10M
            concentrationScore: 80,
            utilizationRate: PRECISION / 20 // 5%
        });

        uint256 score = LiquidityProtection.calculateLiquidityScore(metrics);

        // High liquidity (40) + good concentration (24) + low utilization (30) = 94
        assertGe(score, 90);
    }

    function test_liquidityScore_low() public pure {
        LiquidityProtection.LiquidityMetrics memory metrics = LiquidityProtection.LiquidityMetrics({
            reserve0: 1 ether,
            reserve1: 5000 * PRECISION,
            totalValueUsd: 5000 * PRECISION, // $5k
            concentrationScore: 20,
            utilizationRate: PRECISION * 8 / 10 // 80%
        });

        uint256 score = LiquidityProtection.calculateLiquidityScore(metrics);

        // Low liquidity (0) + poor concentration (6) + high utilization (0) = 6
        assertLe(score, 10);
    }

    // ============ Configuration Tests ============

    function test_defaultConfig() public pure {
        LiquidityProtection.ProtectionConfig memory config = LiquidityProtection.getDefaultConfig();

        assertEq(config.amplificationFactor, 100);
        assertEq(config.maxPriceImpactBps, 300);
        assertTrue(config.virtualReservesEnabled);
        assertTrue(config.dynamicFeesEnabled);
    }

    function test_stablePairConfig() public pure {
        LiquidityProtection.ProtectionConfig memory config = LiquidityProtection.getStablePairConfig();

        assertEq(config.amplificationFactor, 500); // Higher for stable
        assertEq(config.maxPriceImpactBps, 50);    // Tighter for stable
    }

    function test_validateConfig_valid() public pure {
        LiquidityProtection.ProtectionConfig memory config = LiquidityProtection.getDefaultConfig();
        LiquidityProtection.validateConfig(config); // Should not revert
    }

    function test_validateConfig_invalidAmplification() public {
        LiquidityProtection.ProtectionConfig memory config = LiquidityProtection.getDefaultConfig();
        config.amplificationFactor = 2000; // Too high

        vm.expectRevert(LiquidityProtection.InvalidConfiguration.selector);
        LiquidityProtection.validateConfig(config);
    }

    function test_validateConfig_invalidImpact() public {
        LiquidityProtection.ProtectionConfig memory config = LiquidityProtection.getDefaultConfig();
        config.maxPriceImpactBps = 2000; // > 10% absolute max

        vm.expectRevert(LiquidityProtection.InvalidConfiguration.selector);
        LiquidityProtection.validateConfig(config);
    }

    // ============ Composite Protection Tests ============

    function test_applyProtections_allEnabled() public pure {
        LiquidityProtection.ProtectionConfig memory config = LiquidityProtection.getDefaultConfig();
        LiquidityProtection.LiquidityMetrics memory metrics = LiquidityProtection.LiquidityMetrics({
            reserve0: 100 ether,
            reserve1: 200_000 * PRECISION,
            totalValueUsd: 200_000 * PRECISION,
            concentrationScore: 50,
            utilizationRate: PRECISION / 10
        });

        (uint256 fee, uint256 eff0, uint256 eff1) = LiquidityProtection.applyProtections(
            config,
            metrics,
            1 ether,
            2000 * PRECISION
        );

        // Should get base fee (liquidity above threshold)
        assertEq(fee, 30);

        // Should have amplified reserves
        assertEq(eff0, 100 ether * 100);
        assertEq(eff1, 200_000 * PRECISION * 100);
    }

    function test_applyProtections_lowLiquidity() public {
        LiquidityProtection.ProtectionConfig memory config = LiquidityProtection.getDefaultConfig();
        LiquidityProtection.LiquidityMetrics memory metrics = LiquidityProtection.LiquidityMetrics({
            reserve0: 1 ether,
            reserve1: 2000 * PRECISION,
            totalValueUsd: 5000 * PRECISION, // Below minimum
            concentrationScore: 50,
            utilizationRate: PRECISION / 10
        });

        vm.expectRevert(
            abi.encodeWithSelector(
                LiquidityProtection.InsufficientLiquidity.selector,
                5000 * PRECISION,
                10_000 * PRECISION
            )
        );
        LiquidityProtection.applyProtections(
            config,
            metrics,
            1 ether,
            2000 * PRECISION
        );
    }

    // ============ Recommended Fee Tests ============

    function test_getRecommendedFee_stablePair() public pure {
        uint256 fee = LiquidityProtection.getRecommendedFee(
            true,                    // stable pair
            PRECISION / 100,         // 1% volatility
            1_000_000 * PRECISION    // $1M liquidity
        );

        assertEq(fee, 5); // 0.05%
    }

    function test_getRecommendedFee_volatilePair() public pure {
        uint256 fee = LiquidityProtection.getRecommendedFee(
            false,                   // not stable
            6 * PRECISION / 100,     // 6% volatility
            1_000_000 * PRECISION    // $1M liquidity
        );

        assertEq(fee, 100); // 1%
    }

    function test_getRecommendedFee_lowLiquidity() public pure {
        uint256 fee = LiquidityProtection.getRecommendedFee(
            false,
            2 * PRECISION / 100,     // 2% volatility
            50_000 * PRECISION       // $50k (half threshold)
        );

        // Should be 2x the base 30 bps
        assertEq(fee, 60);
    }
}
