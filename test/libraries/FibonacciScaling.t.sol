// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/FibonacciScaling.sol";

/**
 * @title FibonacciScalingTest
 * @notice Tests for Fibonacci-based scaling functions
 */
contract FibonacciScalingTest is Test {
    uint256 constant PRECISION = 1e18;

    // ============ Fibonacci Sequence Tests ============

    function test_fibonacci_sequence() public pure {
        // First few Fibonacci numbers: 0, 1, 1, 2, 3, 5, 8, 13, 21, 34
        assertEq(FibonacciScaling.fibonacci(0), 0);
        assertEq(FibonacciScaling.fibonacci(1), 1);
        assertEq(FibonacciScaling.fibonacci(2), 1);
        assertEq(FibonacciScaling.fibonacci(3), 2);
        assertEq(FibonacciScaling.fibonacci(4), 3);
        assertEq(FibonacciScaling.fibonacci(5), 5);
        assertEq(FibonacciScaling.fibonacci(6), 8);
        assertEq(FibonacciScaling.fibonacci(7), 13);
        assertEq(FibonacciScaling.fibonacci(8), 21);
        assertEq(FibonacciScaling.fibonacci(9), 34);
        assertEq(FibonacciScaling.fibonacci(10), 55);
    }

    function test_fibonacci_sum() public pure {
        // Sum of first n Fibonacci numbers = Fib(n+2) - 1
        assertEq(FibonacciScaling.fibonacciSum(1), 1);  // 1
        assertEq(FibonacciScaling.fibonacciSum(2), 2);  // 1 + 1
        assertEq(FibonacciScaling.fibonacciSum(3), 4);  // 1 + 1 + 2
        assertEq(FibonacciScaling.fibonacciSum(4), 7);  // 1 + 1 + 2 + 3
        assertEq(FibonacciScaling.fibonacciSum(5), 12); // 1 + 1 + 2 + 3 + 5
    }

    function test_isFibonacci() public pure {
        // Fibonacci numbers
        assertTrue(FibonacciScaling.isFibonacci(0));
        assertTrue(FibonacciScaling.isFibonacci(1));
        assertTrue(FibonacciScaling.isFibonacci(2));
        assertTrue(FibonacciScaling.isFibonacci(3));
        assertTrue(FibonacciScaling.isFibonacci(5));
        assertTrue(FibonacciScaling.isFibonacci(8));
        assertTrue(FibonacciScaling.isFibonacci(13));
        assertTrue(FibonacciScaling.isFibonacci(21));
        assertTrue(FibonacciScaling.isFibonacci(55));

        // Non-Fibonacci numbers
        assertFalse(FibonacciScaling.isFibonacci(4));
        assertFalse(FibonacciScaling.isFibonacci(6));
        assertFalse(FibonacciScaling.isFibonacci(7));
        assertFalse(FibonacciScaling.isFibonacci(9));
        assertFalse(FibonacciScaling.isFibonacci(10));
    }

    // ============ Throughput Tier Tests ============

    function test_getThroughputTier_firstTier() public pure {
        uint256 baseUnit = 1 ether;

        // Volume within first tier (Fib(1) = 1)
        (uint8 tier, uint256 maxAllowed, uint256 utilization) =
            FibonacciScaling.getThroughputTier(0.5 ether, baseUnit);

        assertEq(tier, 0);
        assertEq(maxAllowed, 1 ether); // Fib(1) * baseUnit
        assertEq(utilization, 5000); // 50%
    }

    function test_getThroughputTier_progression() public pure {
        uint256 baseUnit = 1 ether;

        // Tier 0: up to 1 ETH (Fib(1) = 1)
        // Tier 1: up to 2 ETH (Fib(1) + Fib(2) = 1 + 1)
        // Tier 2: up to 4 ETH (1 + 1 + 2)
        // Tier 3: up to 7 ETH (1 + 1 + 2 + 3)
        // Tier 4: up to 12 ETH (1 + 1 + 2 + 3 + 5)

        (uint8 tier1, , ) = FibonacciScaling.getThroughputTier(1.5 ether, baseUnit);
        assertEq(tier1, 1);

        (uint8 tier2, , ) = FibonacciScaling.getThroughputTier(3 ether, baseUnit);
        assertEq(tier2, 2);

        (uint8 tier3, , ) = FibonacciScaling.getThroughputTier(6 ether, baseUnit);
        assertEq(tier3, 3);

        (uint8 tier4, , ) = FibonacciScaling.getThroughputTier(10 ether, baseUnit);
        assertEq(tier4, 4);
    }

    function test_getFibonacciFeeMultiplier() public pure {
        uint256 baseFee = 30; // 0.3%

        // Tier 0: base fee
        assertEq(FibonacciScaling.getFibonacciFeeMultiplier(0, baseFee), 30);

        // Higher tiers have higher fees (golden ratio scaling)
        uint256 tier5Fee = FibonacciScaling.getFibonacciFeeMultiplier(5, baseFee);
        assertGt(tier5Fee, baseFee);
        assertLe(tier5Fee, baseFee * 3); // Max 3x

        uint256 tier10Fee = FibonacciScaling.getFibonacciFeeMultiplier(10, baseFee);
        assertGt(tier10Fee, tier5Fee);
        assertLe(tier10Fee, baseFee * 3);
    }

    // ============ Rate Limit Tests ============

    function test_calculateRateLimit_lowUsage() public pure {
        uint256 maxBandwidth = 100 ether;
        uint256 windowSeconds = 1 hours;

        // Low usage (< 23.6%): full remaining allowed
        (uint256 allowed, uint256 cooldown) =
            FibonacciScaling.calculateRateLimit(10 ether, maxBandwidth, windowSeconds);

        assertEq(allowed, 90 ether); // Full remaining
        assertEq(cooldown, 0);
    }

    function test_calculateRateLimit_mediumUsage() public pure {
        uint256 maxBandwidth = 100 ether;
        uint256 windowSeconds = 1 hours;

        // Medium usage (50%): 50% of remaining allowed
        (uint256 allowed, ) =
            FibonacciScaling.calculateRateLimit(55 ether, maxBandwidth, windowSeconds);

        // At 55% usage, we're in the 50-61.8% band, so 50% of remaining (45 ether) = 22.5 ether
        assertLt(allowed, 45 ether);
        assertGt(allowed, 0);
    }

    function test_calculateRateLimit_maxedOut() public pure {
        uint256 maxBandwidth = 100 ether;
        uint256 windowSeconds = 1 hours;

        // Full usage: nothing allowed, cooldown required
        (uint256 allowed, uint256 cooldown) =
            FibonacciScaling.calculateRateLimit(100 ether, maxBandwidth, windowSeconds);

        assertEq(allowed, 0);
        assertGt(cooldown, 0);
        // Cooldown should be ~61.8% of window (inverse golden ratio)
        assertApproxEqRel(cooldown, (windowSeconds * 618) / 1000, 0.01e18);
    }

    // ============ Price Retracement Tests ============

    function test_calculateRetracementLevels() public pure {
        uint256 high = 2000 * PRECISION; // $2000
        uint256 low = 1000 * PRECISION;  // $1000

        FibonacciScaling.FibRetracementLevels memory levels =
            FibonacciScaling.calculateRetracementLevels(high, low);

        assertEq(levels.level0, high); // 0% = high
        assertEq(levels.level1000, low); // 100% = low

        // 23.6% retracement from high
        assertApproxEqRel(levels.level236, 1764 * PRECISION, 0.01e18);

        // 38.2% retracement from high
        assertApproxEqRel(levels.level382, 1618 * PRECISION, 0.01e18);

        // 50% retracement from high
        assertEq(levels.level500, 1500 * PRECISION);

        // 61.8% retracement from high
        assertApproxEqRel(levels.level618, 1382 * PRECISION, 0.01e18);

        // 78.6% retracement from high
        assertApproxEqRel(levels.level786, 1214 * PRECISION, 0.01e18);
    }

    function test_calculatePriceBands() public pure {
        uint256 currentPrice = 2000 * PRECISION;
        uint256 volatilityBps = 500; // 5%

        FibonacciScaling.FibPriceBand memory bands =
            FibonacciScaling.calculatePriceBands(currentPrice, volatilityBps);

        assertEq(bands.pivot, currentPrice);

        // Support 1 = current - 23.6% of (5% of current)
        // = 2000 - 0.236 * 100 = 2000 - 23.6 = ~1976.4
        assertLt(bands.support1, currentPrice);
        assertGt(bands.support1, bands.support2);

        // Resistance 1 = current + 23.6% of (5% of current)
        assertGt(bands.resist1, currentPrice);
        assertLt(bands.resist1, bands.resist2);
    }

    function test_detectFibonacciLevel() public pure {
        uint256 high = 2000 * PRECISION;
        uint256 low = 1000 * PRECISION;
        uint256 tolerance = 100; // 1%

        // At 50% level (1500)
        (uint256 level, bool isSupport) =
            FibonacciScaling.detectFibonacciLevel(1500 * PRECISION, high, low, tolerance);
        assertEq(level, 500);

        // At 61.8% level (~1382)
        (level, isSupport) =
            FibonacciScaling.detectFibonacciLevel(1382 * PRECISION, high, low, tolerance);
        assertEq(level, 618);

        // Between levels (no detection)
        (level, ) =
            FibonacciScaling.detectFibonacciLevel(1450 * PRECISION, high, low, tolerance);
        assertEq(level, 9999);
    }

    // ============ Golden Ratio Tests ============

    function test_goldenRatioMean() public pure {
        uint256 price1 = 1000 * PRECISION;
        uint256 price2 = 2000 * PRECISION;

        uint256 mean = FibonacciScaling.goldenRatioMean(price1, price2);

        // Golden mean should be closer to lower price (at 61.8% from lower)
        // 1000 + (1000 * 0.618) = ~1618
        assertApproxEqRel(mean, 1618 * PRECISION, 0.01e18);

        // Reversed order should give same result
        uint256 mean2 = FibonacciScaling.goldenRatioMean(price2, price1);
        assertEq(mean, mean2);
    }

    function test_fibonacciWeightedPrice() public pure {
        uint256[] memory prices = new uint256[](3);
        uint256[] memory volumes = new uint256[](3);

        prices[0] = 1000 * PRECISION;
        prices[1] = 1100 * PRECISION;
        prices[2] = 1200 * PRECISION;

        volumes[0] = 10 ether;
        volumes[1] = 20 ether;
        volumes[2] = 30 ether;

        uint256 weightedPrice = FibonacciScaling.fibonacciWeightedPrice(prices, volumes);

        // Fibonacci weights: 1, 1, 2 (for first 3)
        // Weight 1: 10 * 1 = 10
        // Weight 2: 20 * 1 = 20
        // Weight 3: 30 * 2 = 60
        // Total weight: 90
        // Weighted sum: 1000*10 + 1100*20 + 1200*60 = 10000 + 22000 + 72000 = 104000
        // Weighted avg: 104000 / 90 = ~1155.56

        assertGt(weightedPrice, 1100 * PRECISION);
        assertLt(weightedPrice, 1200 * PRECISION);
    }

    // ============ Liquidity Score Tests ============

    function test_calculateFibLiquidityScore() public pure {
        uint256 currentPrice = 2000 * PRECISION;
        uint256 priceRange = 200 * PRECISION;

        // Low reserves: low score
        uint256 lowScore = FibonacciScaling.calculateFibLiquidityScore(
            1000 * PRECISION, // reserves
            currentPrice,
            priceRange
        );
        assertLt(lowScore, 50);

        // High reserves: high score
        uint256 highScore = FibonacciScaling.calculateFibLiquidityScore(
            10000 * PRECISION, // reserves
            currentPrice,
            priceRange
        );
        assertGt(highScore, 80);
    }

    // ============ Fuzz Tests ============

    function testFuzz_fibonacci_goldenRatio(uint8 n) public pure {
        vm.assume(n >= 2 && n <= 45);

        // Fib(n) / Fib(n-1) should approach golden ratio as n increases
        uint256 fibN = FibonacciScaling.fibonacci(n);
        uint256 fibN1 = FibonacciScaling.fibonacci(n - 1);

        if (fibN1 > 0) {
            uint256 ratio = (fibN * PRECISION) / fibN1;
            // Should be within 5% of golden ratio for n >= 10
            if (n >= 10) {
                assertApproxEqRel(ratio, FibonacciScaling.PHI, 0.05e18);
            }
        }
    }

    function testFuzz_retracementLevels_ordered(uint128 _high, uint128 _low) public pure {
        uint256 high = uint256(_high) + 1;
        uint256 low = uint256(_low);
        vm.assume(high > low);

        FibonacciScaling.FibRetracementLevels memory levels =
            FibonacciScaling.calculateRetracementLevels(high, low);

        // Levels should be in descending order
        assertGe(levels.level0, levels.level236);
        assertGe(levels.level236, levels.level382);
        assertGe(levels.level382, levels.level500);
        assertGe(levels.level500, levels.level618);
        assertGe(levels.level618, levels.level786);
        assertGe(levels.level786, levels.level1000);
    }

    function testFuzz_goldenRatioMean_bounded(uint128 _p1, uint128 _p2) public pure {
        uint256 p1 = uint256(_p1) + 1;
        uint256 p2 = uint256(_p2) + 1;

        uint256 mean = FibonacciScaling.goldenRatioMean(p1, p2);

        // Mean should always be between the two prices
        uint256 lower = p1 < p2 ? p1 : p2;
        uint256 upper = p1 > p2 ? p1 : p2;

        assertGe(mean, lower);
        assertLe(mean, upper);
    }
}
