// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/TruePriceLib.sol";
import "../../contracts/oracles/interfaces/ITruePriceOracle.sol";

contract TruePriceLibWrapper {
    function validatePriceDeviation(uint256 spot, uint256 truePrice, uint256 maxBps)
        external pure returns (bool)
    {
        return TruePriceLib.validatePriceDeviation(spot, truePrice, maxBps);
    }

    function requirePriceInRange(uint256 spot, uint256 truePrice, uint256 maxBps) external pure {
        TruePriceLib.requirePriceInRange(spot, truePrice, maxBps);
    }

    function adjustDeviationForStablecoin(uint256 baseBps, bool usdtDom, bool usdcDom)
        external pure returns (uint256)
    {
        return TruePriceLib.adjustDeviationForStablecoin(baseBps, usdtDom, usdcDom);
    }

    function adjustDeviationForRegime(uint256 baseBps, ITruePriceOracle.RegimeType regime)
        external pure returns (uint256)
    {
        return TruePriceLib.adjustDeviationForRegime(baseBps, regime);
    }

    function isFresh(uint64 ts, uint256 maxAge) external view returns (bool) {
        return TruePriceLib.isFresh(ts, maxAge);
    }

    function requireFresh(uint64 ts, uint256 maxAge) external view {
        TruePriceLib.requireFresh(ts, maxAge);
    }

    function isManipulationLikely(uint256 prob, uint256 threshold) external pure returns (bool) {
        return TruePriceLib.isManipulationLikely(prob, threshold);
    }

    function requireNoManipulation(uint256 prob, uint256 threshold) external pure {
        TruePriceLib.requireNoManipulation(prob, threshold);
    }

    function zScoreToReversionProbability(int256 z, bool usdtDom)
        external pure returns (uint256)
    {
        return TruePriceLib.zScoreToReversionProbability(z, usdtDom);
    }

    function abs_(int256 x) external pure returns (uint256) {
        return TruePriceLib.abs(x);
    }

    function bpsOf(uint256 amount, uint256 bps) external pure returns (uint256) {
        return TruePriceLib.bpsOf(amount, bps);
    }
}

contract TruePriceLibTest is Test {
    TruePriceLibWrapper lib;

    function setUp() public {
        lib = new TruePriceLibWrapper();
    }

    // ============ validatePriceDeviation ============

    function test_validatePriceDeviation_withinBounds() public view {
        assertTrue(lib.validatePriceDeviation(101, 100, 500)); // 1% < 5%
    }

    function test_validatePriceDeviation_exceeds() public view {
        assertFalse(lib.validatePriceDeviation(110, 100, 500)); // 10% > 5%
    }

    function test_validatePriceDeviation_zeroTruePrice() public view {
        assertTrue(lib.validatePriceDeviation(100, 0, 500)); // skip check
    }

    function test_validatePriceDeviation_equal() public view {
        assertTrue(lib.validatePriceDeviation(100, 100, 0));
    }

    function test_validatePriceDeviation_spotBelow() public view {
        assertTrue(lib.validatePriceDeviation(95, 100, 500)); // 5% = 5%
        assertFalse(lib.validatePriceDeviation(94, 100, 500)); // 6% > 5%
    }

    // ============ requirePriceInRange ============

    function test_requirePriceInRange_reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(TruePriceLib.PriceDeviationTooHigh.selector, 200, 100, 10000)
        );
        lib.requirePriceInRange(200, 100, 500);
    }

    // ============ adjustDeviationForStablecoin ============

    function test_adjustDeviation_usdt() public view {
        // 80% of 500 = 400
        assertEq(lib.adjustDeviationForStablecoin(500, true, false), 400);
    }

    function test_adjustDeviation_usdc() public view {
        // 120% of 500 = 600
        assertEq(lib.adjustDeviationForStablecoin(500, false, true), 600);
    }

    function test_adjustDeviation_neither() public view {
        assertEq(lib.adjustDeviationForStablecoin(500, false, false), 500);
    }

    // ============ adjustDeviationForRegime ============

    function test_adjustDeviation_cascade() public view {
        // 60% of 1000 = 600
        assertEq(lib.adjustDeviationForRegime(1000, ITruePriceOracle.RegimeType.CASCADE), 600);
    }

    function test_adjustDeviation_manipulation() public view {
        // 70% of 1000 = 700
        assertEq(lib.adjustDeviationForRegime(1000, ITruePriceOracle.RegimeType.MANIPULATION), 700);
    }

    function test_adjustDeviation_highLeverage() public view {
        // 85% of 1000 = 850
        assertEq(lib.adjustDeviationForRegime(1000, ITruePriceOracle.RegimeType.HIGH_LEVERAGE), 850);
    }

    function test_adjustDeviation_trend() public view {
        // 130% of 1000 = 1300
        assertEq(lib.adjustDeviationForRegime(1000, ITruePriceOracle.RegimeType.TREND), 1300);
    }

    function test_adjustDeviation_lowVol() public view {
        // 70% of 1000 = 700
        assertEq(lib.adjustDeviationForRegime(1000, ITruePriceOracle.RegimeType.LOW_VOLATILITY), 700);
    }

    function test_adjustDeviation_normal() public view {
        assertEq(lib.adjustDeviationForRegime(1000, ITruePriceOracle.RegimeType.NORMAL), 1000);
    }

    // ============ Freshness ============

    function test_isFresh_valid() public {
        vm.warp(1000);
        assertTrue(lib.isFresh(uint64(900), 200)); // 900 + 200 = 1100 > 1000
    }

    function test_isFresh_stale() public {
        vm.warp(1000);
        assertFalse(lib.isFresh(uint64(700), 200)); // 700 + 200 = 900 < 1000
    }

    function test_isFresh_zeroTimestamp() public {
        vm.warp(1000);
        assertFalse(lib.isFresh(0, 200));
    }

    function test_requireFresh_reverts() public {
        vm.warp(1000);
        vm.expectRevert(
            abi.encodeWithSelector(TruePriceLib.StalePrice.selector, uint64(500), 200)
        );
        lib.requireFresh(uint64(500), 200);
    }

    // ============ Manipulation Detection ============

    function test_isManipulationLikely_true() public view {
        assertTrue(lib.isManipulationLikely(0.8e18, 0.5e18));
    }

    function test_isManipulationLikely_false() public view {
        assertFalse(lib.isManipulationLikely(0.3e18, 0.5e18));
    }

    function test_requireNoManipulation_reverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(TruePriceLib.ManipulationDetected.selector, 0.8e18, 0.5e18)
        );
        lib.requireNoManipulation(0.8e18, 0.5e18);
    }

    // ============ Z-Score Reversion Probability ============

    function test_zScore_zero() public view {
        // z=0 → probability = 0/4 = 0
        assertEq(lib.zScoreToReversionProbability(0, false), 0);
    }

    function test_zScore_halfSigma() public view {
        // z=0.5e18 → absZ/4 = 0.125e18
        assertEq(lib.zScoreToReversionProbability(0.5e18, false), 0.5e18 / 4);
    }

    function test_zScore_negative() public view {
        // Negative z-score uses absolute value
        assertEq(
            lib.zScoreToReversionProbability(-1.5e18, false),
            lib.zScoreToReversionProbability(1.5e18, false)
        );
    }

    function test_zScore_highSigma_capped() public view {
        // Very high z → capped at ~0.93e18
        uint256 prob = lib.zScoreToReversionProbability(10e18, false);
        assertEq(prob, (1e18 * 93) / 100);
    }

    function test_zScore_usdtBoost() public view {
        uint256 withoutUsdt = lib.zScoreToReversionProbability(2e18, false);
        uint256 withUsdt = lib.zScoreToReversionProbability(2e18, true);
        // USDT adds 10%
        assertGt(withUsdt, withoutUsdt);
        assertEq(withUsdt, withoutUsdt + withoutUsdt / 10);
    }

    // ============ Utility ============

    function test_abs_positive() public view {
        assertEq(lib.abs_(42), 42);
    }

    function test_abs_negative() public view {
        assertEq(lib.abs_(-42), 42);
    }

    function test_abs_zero() public view {
        assertEq(lib.abs_(0), 0);
    }

    function test_bpsOf() public view {
        assertEq(lib.bpsOf(1000, 500), 50); // 5% of 1000
    }
}
