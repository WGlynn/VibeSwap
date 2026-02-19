// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/FibonacciScaling.sol";

contract FibWrapper {
    function fibonacci(uint8 n) external pure returns (uint256) {
        return FibonacciScaling.fibonacci(n);
    }

    function fibonacciSum(uint8 n) external pure returns (uint256) {
        return FibonacciScaling.fibonacciSum(n);
    }

    function isFibonacci(uint256 n) external pure returns (bool) {
        return FibonacciScaling.isFibonacci(n);
    }

    function getThroughputTier(uint256 volume, uint256 baseUnit)
        external pure returns (uint8, uint256, uint256)
    {
        return FibonacciScaling.getThroughputTier(volume, baseUnit);
    }

    function getFibonacciFeeMultiplier(uint8 tier, uint256 baseFee)
        external pure returns (uint256)
    {
        return FibonacciScaling.getFibonacciFeeMultiplier(tier, baseFee);
    }

    function calculateRateLimit(uint256 usage, uint256 maxBw, uint256 windowSec)
        external pure returns (uint256, uint256)
    {
        return FibonacciScaling.calculateRateLimit(usage, maxBw, windowSec);
    }

    function calculateRetracementLevels(uint256 high, uint256 low)
        external pure returns (FibonacciScaling.FibRetracementLevels memory)
    {
        return FibonacciScaling.calculateRetracementLevels(high, low);
    }

    function calculatePriceBands(uint256 price, uint256 volBps)
        external pure returns (FibonacciScaling.FibPriceBand memory)
    {
        return FibonacciScaling.calculatePriceBands(price, volBps);
    }

    function detectFibonacciLevel(uint256 price, uint256 high, uint256 low, uint256 toleranceBps)
        external pure returns (uint256, bool)
    {
        return FibonacciScaling.detectFibonacciLevel(price, high, low, toleranceBps);
    }

    function fibonacciWeightedPrice(uint256[] memory prices, uint256[] memory volumes)
        external pure returns (uint256)
    {
        return FibonacciScaling.fibonacciWeightedPrice(prices, volumes);
    }

    function goldenRatioMean(uint256 p1, uint256 p2) external pure returns (uint256) {
        return FibonacciScaling.goldenRatioMean(p1, p2);
    }

    function calculateFibLiquidityScore(uint256 reserves, uint256 price, uint256 range)
        external pure returns (uint256)
    {
        return FibonacciScaling.calculateFibLiquidityScore(reserves, price, range);
    }
}

contract FibonacciScalingTest is Test {
    FibWrapper lib;
    uint256 constant PRECISION = 1e18;

    function setUp() public {
        lib = new FibWrapper();
    }

    // ============ fibonacci() ============

    function test_fibonacci_sequence() public view {
        assertEq(lib.fibonacci(0), 0);
        assertEq(lib.fibonacci(1), 1);
        assertEq(lib.fibonacci(2), 1);
        assertEq(lib.fibonacci(3), 2);
        assertEq(lib.fibonacci(4), 3);
        assertEq(lib.fibonacci(5), 5);
        assertEq(lib.fibonacci(6), 8);
        assertEq(lib.fibonacci(7), 13);
        assertEq(lib.fibonacci(10), 55);
        assertEq(lib.fibonacci(20), 6765);
    }

    function test_fibonacci_46() public view {
        assertEq(lib.fibonacci(46), 1836311903);
    }

    // ============ fibonacciSum() ============

    function test_fibonacciSum_identity() public view {
        // Sum of first n Fib numbers = Fib(n+2) - 1
        assertEq(lib.fibonacciSum(0), 0);
        assertEq(lib.fibonacciSum(1), 1);  // Fib(3) - 1 = 2 - 1
        assertEq(lib.fibonacciSum(5), 12); // Fib(7) - 1 = 13 - 1
    }

    // ============ isFibonacci() ============

    function test_isFibonacci_true() public view {
        assertTrue(lib.isFibonacci(0));
        assertTrue(lib.isFibonacci(1));
        assertTrue(lib.isFibonacci(2));
        assertTrue(lib.isFibonacci(3));
        assertTrue(lib.isFibonacci(5));
        assertTrue(lib.isFibonacci(8));
        assertTrue(lib.isFibonacci(13));
        assertTrue(lib.isFibonacci(21));
        assertTrue(lib.isFibonacci(55));
    }

    function test_isFibonacci_false() public view {
        assertFalse(lib.isFibonacci(4));
        assertFalse(lib.isFibonacci(6));
        assertFalse(lib.isFibonacci(7));
        assertFalse(lib.isFibonacci(9));
        assertFalse(lib.isFibonacci(10));
    }

    // ============ getThroughputTier() ============

    function test_throughputTier_firstTier() public view {
        // Volume within first tier: Fib(1) * base = 1 * base
        (uint8 tier,,) = lib.getThroughputTier(0.5e18, 1e18);
        assertEq(tier, 0);
    }

    function test_throughputTier_secondTier() public view {
        // Volume beyond first tier but within second
        // Tier 1: Fib(1)*base = 1e18, Tier 2: Fib(2)*base = 1e18, cumulative = 2e18
        (uint8 tier,,) = lib.getThroughputTier(1.5e18, 1e18);
        assertEq(tier, 1);
    }

    // ============ getFibonacciFeeMultiplier() ============

    function test_feeMultiplier_tierZero() public view {
        assertEq(lib.getFibonacciFeeMultiplier(0, 30), 30);
    }

    function test_feeMultiplier_tierOne() public view {
        // multiplier = 1e18 + (PHI - 1e18) * 1 / 10 = 1e18 + 0.0618...e18
        uint256 fee = lib.getFibonacciFeeMultiplier(1, 30);
        assertGt(fee, 30);
        assertLt(fee, 60);
    }

    function test_feeMultiplier_capped() public view {
        // Very high tier → capped at 3x
        uint256 fee = lib.getFibonacciFeeMultiplier(100, 30);
        assertEq(fee, 90); // 3 * 30
    }

    // ============ calculateRateLimit() ============

    function test_rateLimit_lowUsage() public view {
        // Usage under 23.6% → full remaining
        (uint256 allowed, uint256 cooldown) = lib.calculateRateLimit(10e18, 100e18, 3600);
        assertEq(allowed, 90e18);
        assertEq(cooldown, 0);
    }

    function test_rateLimit_highUsage() public view {
        // Usage at 80% → 23.6% of remaining
        (uint256 allowed, uint256 cooldown) = lib.calculateRateLimit(80e18, 100e18, 3600);
        // remaining = 20e18, allowed = 20e18 * 236/1000 ≈ 4.72e18
        assertLt(allowed, 5e18);
        assertGt(allowed, 4e18);
        assertEq(cooldown, 0);
    }

    function test_rateLimit_maxedOut() public view {
        // Usage at max → cooldown
        (uint256 allowed, uint256 cooldown) = lib.calculateRateLimit(100e18, 100e18, 3600);
        assertEq(allowed, 0);
        assertGt(cooldown, 0); // Golden ratio cooldown
    }

    // ============ calculateRetracementLevels() ============

    function test_retracementLevels_basic() public view {
        FibonacciScaling.FibRetracementLevels memory lvls = lib.calculateRetracementLevels(200, 100);
        assertEq(lvls.level0, 200);
        assertEq(lvls.level1000, 100);
        // 50% retracement = 150
        assertEq(lvls.level500, 150);
        // 23.6% → 200 - 100 * 0.236 = 200 - 23.6 ≈ 176
        assertApproxEqAbs(lvls.level236, 176, 1);
    }

    function test_retracementLevels_equal() public view {
        FibonacciScaling.FibRetracementLevels memory lvls = lib.calculateRetracementLevels(100, 100);
        assertEq(lvls.level0, 100);
        assertEq(lvls.level500, 100);
        assertEq(lvls.level1000, 100);
    }

    function test_retracementLevels_reverts() public {
        vm.expectRevert("High must be >= low");
        lib.calculateRetracementLevels(50, 100);
    }

    // ============ calculatePriceBands() ============

    function test_priceBands_symmetric() public view {
        FibonacciScaling.FibPriceBand memory b = lib.calculatePriceBands(1000e18, 500);
        assertEq(b.pivot, 1000e18);
        // Bandwidth = 1000e18 * 500 / 10000 = 50e18
        // Support1 = 1000 - 50 * 0.236 = 1000 - 11.8 = 988.2
        assertLt(b.support1, 1000e18);
        assertGt(b.resist1, 1000e18);
    }

    // ============ detectFibonacciLevel() ============

    function test_detectLevel_atHigh() public view {
        (uint256 level, bool isSupport) = lib.detectFibonacciLevel(200, 200, 100, 100);
        assertEq(level, 0);
        assertFalse(isSupport);
    }

    function test_detectLevel_atLow() public view {
        (uint256 level, bool isSupport) = lib.detectFibonacciLevel(100, 200, 100, 100);
        assertEq(level, 1000);
        assertTrue(isSupport);
    }

    function test_detectLevel_noLevel() public view {
        // Far from any Fibonacci level
        (uint256 level,) = lib.detectFibonacciLevel(142, 200, 100, 50);
        assertEq(level, 9999);
    }

    // ============ fibonacciWeightedPrice() ============

    function test_fibWeightedPrice_singleElement() public view {
        uint256[] memory prices = new uint256[](1);
        uint256[] memory volumes = new uint256[](1);
        prices[0] = 100;
        volumes[0] = 10;
        assertEq(lib.fibonacciWeightedPrice(prices, volumes), 100);
    }

    function test_fibWeightedPrice_twoElements() public view {
        uint256[] memory prices = new uint256[](2);
        uint256[] memory volumes = new uint256[](2);
        prices[0] = 100; volumes[0] = 10;
        prices[1] = 200; volumes[1] = 10;
        // Fib(1)=1 for first, Fib(2)=1 for second → equal weights
        // Weighted avg = (100*10 + 200*10) / (10 + 10) = 150
        assertEq(lib.fibonacciWeightedPrice(prices, volumes), 150);
    }

    // ============ goldenRatioMean() ============

    function test_goldenMean_basic() public view {
        uint256 mean = lib.goldenRatioMean(100e18, 200e18);
        // mean = 100e18 + (100e18 * PHI_INVERSE) / 1e18
        // = 100e18 + ~61.8e18 = ~161.8e18
        assertApproxEqAbs(mean, 161803398874989500000, 1e15);
    }

    function test_goldenMean_equal() public view {
        assertEq(lib.goldenRatioMean(100e18, 100e18), 100e18);
    }

    function test_goldenMean_commutative() public view {
        // Not quite commutative (closer to higher price) but let's verify behavior
        uint256 m1 = lib.goldenRatioMean(100e18, 200e18);
        uint256 m2 = lib.goldenRatioMean(200e18, 100e18);
        // m1 = 100 + 100*0.618 = 161.8
        // m2 = 100 + 100*0.618 = 161.8 (same because range is same)
        assertEq(m1, m2);
    }

    // ============ calculateFibLiquidityScore() ============

    function test_fibLiqScore_zero() public view {
        assertEq(lib.calculateFibLiquidityScore(0, 100e18, 10e18), 0);
    }

    function test_fibLiqScore_perfect() public view {
        // reserves >= idealReserves → score 100
        uint256 ideal = (100e18 * 1618033988749895000) / 1e18;
        uint256 score = lib.calculateFibLiquidityScore(ideal + 1e18, 100e18, 10e18);
        assertEq(score, 100);
    }

    // ============ Constants ============

    function test_constants() public pure {
        assertEq(FibonacciScaling.PHI, 1618033988749895000);
        assertEq(FibonacciScaling.PHI_INVERSE, 618033988749895000);
        assertEq(FibonacciScaling.MAX_FIB_INDEX, 46);
    }
}
