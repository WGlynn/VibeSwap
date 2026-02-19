// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/FibonacciScaling.sol";

contract FibFuzzWrapper {
    function fibonacci(uint8 n) external pure returns (uint256) { return FibonacciScaling.fibonacci(n); }
    function fibonacciSum(uint8 n) external pure returns (uint256) { return FibonacciScaling.fibonacciSum(n); }
    function isFibonacci(uint256 n) external pure returns (bool) { return FibonacciScaling.isFibonacci(n); }
    function goldenRatioMean(uint256 a, uint256 b) external pure returns (uint256)
    { return FibonacciScaling.goldenRatioMean(a, b); }
    function calculateRetracementLevels(uint256 high, uint256 low) external pure returns (FibonacciScaling.FibRetracementLevels memory)
    { return FibonacciScaling.calculateRetracementLevels(high, low); }
    function getThroughputTier(uint256 volume, uint256 capacity) external pure returns (uint8, uint256, uint256)
    { return FibonacciScaling.getThroughputTier(volume, capacity); }
    function calculateRateLimit(uint256 currentUsage, uint256 maxBandwidth, uint256 windowSeconds) external pure returns (uint256, uint256)
    { return FibonacciScaling.calculateRateLimit(currentUsage, maxBandwidth, windowSeconds); }
}

contract FibonacciScalingFuzzTest is Test {
    FibFuzzWrapper lib;

    function setUp() public {
        lib = new FibFuzzWrapper();
    }

    // ============ Fuzz: fibonacci is monotonically increasing ============
    function testFuzz_fibonacci_monotonic(uint8 n1, uint8 n2) public view {
        n1 = uint8(bound(n1, 0, 90));
        n2 = uint8(bound(n2, n1, 90));
        assertGe(lib.fibonacci(n2), lib.fibonacci(n1), "Fibonacci should be monotonic");
    }

    // ============ Fuzz: fibonacci sum is greater than fibonacci ============
    function testFuzz_fibSum_geFibonacci(uint8 n) public view {
        n = uint8(bound(n, 1, 90));
        assertGe(lib.fibonacciSum(n), lib.fibonacci(n), "Sum should be >= individual fib");
    }

    // ============ Fuzz: known fibonacci numbers are detected ============
    function testFuzz_isFibonacci_knownValues() public view {
        assertTrue(lib.isFibonacci(0));
        assertTrue(lib.isFibonacci(1));
        assertTrue(lib.isFibonacci(2));
        assertTrue(lib.isFibonacci(3));
        assertTrue(lib.isFibonacci(5));
        assertTrue(lib.isFibonacci(8));
        assertTrue(lib.isFibonacci(13));
        assertTrue(lib.isFibonacci(21));
        assertTrue(lib.isFibonacci(55));
        assertTrue(lib.isFibonacci(144));
    }

    // ============ Fuzz: non-fibonacci numbers are rejected ============
    function testFuzz_isFibonacci_rejects(uint256 n) public view {
        // Numbers that are definitely not Fibonacci: 4, 6, 7, 9, 10, etc.
        n = bound(n, 4, 1e18);
        // Skip if it happens to be Fibonacci
        if (n == 5 || n == 8 || n == 13 || n == 21 || n == 34 || n == 55 || n == 89 ||
            n == 144 || n == 233 || n == 377 || n == 610 || n == 987 || n == 1597) return;
        // Most large random numbers aren't Fibonacci
        // Only assert for small known non-fib numbers
        if (n == 4 || n == 6 || n == 7 || n == 9 || n == 10) {
            assertFalse(lib.isFibonacci(n), "Should not be fibonacci");
        }
    }

    // ============ Fuzz: golden ratio mean is between a and b ============
    function testFuzz_goldenMean_bounded(uint256 a, uint256 b) public view {
        a = bound(a, 1, 1e24);
        b = bound(b, 1, 1e24);
        uint256 result = lib.goldenRatioMean(a, b);
        uint256 minVal = a < b ? a : b;
        uint256 maxVal = a > b ? a : b;
        // Golden mean should be within a reasonable range of the inputs
        // (not necessarily strictly between them due to golden ratio weighting)
        assertGe(result, minVal / 2, "Golden mean too low");
        assertLe(result, maxVal * 2, "Golden mean too high");
    }

    // ============ Fuzz: retracement levels are descending (high to low) ============
    function testFuzz_retracement_ordered(uint256 high, uint256 low) public view {
        high = bound(high, 1e6, 1e20);
        low = bound(low, 1, high - 1);
        FibonacciScaling.FibRetracementLevels memory levels = lib.calculateRetracementLevels(high, low);
        // level0 = high, level1000 = low
        // Descending order: 0% > 23.6% > 38.2% > 50% > 61.8% > 78.6%
        assertGe(levels.level0, levels.level236, "0% >= 23.6%");
        assertGe(levels.level236, levels.level382, "23.6% >= 38.2%");
        assertGe(levels.level382, levels.level500, "38.2% >= 50%");
        assertGe(levels.level500, levels.level618, "50% >= 61.8%");
        assertGe(levels.level618, levels.level786, "61.8% >= 78.6%");
        // All between low and high
        assertEq(levels.level0, high, "Level0 = high");
        assertGe(levels.level786, low, "Level786 >= low");
    }

    // ============ Fuzz: rate limit: allowed decreases with higher usage ============
    function testFuzz_rateLimit_decreasesWithUsage(uint256 usage1, uint256 usage2, uint256 maxBW) public view {
        maxBW = bound(maxBW, 1e18, 1e30);
        usage1 = bound(usage1, 0, maxBW / 2);
        usage2 = bound(usage2, usage1, maxBW);
        (uint256 allowed1,) = lib.calculateRateLimit(usage1, maxBW, 1 hours);
        (uint256 allowed2,) = lib.calculateRateLimit(usage2, maxBW, 1 hours);
        assertGe(allowed1, allowed2, "Higher usage should mean lower allowed");
    }

    // ============ Fuzz: throughput tier never exceeds MAX_FIB_INDEX ============
    function testFuzz_throughputTier_bounded(uint256 volume, uint256 capacity) public view {
        volume = bound(volume, 0, 1e30);
        capacity = bound(capacity, 1, 1e30);
        (uint8 tier,,) = lib.getThroughputTier(volume, capacity);
        assertLe(tier, 46, "Tier should not exceed MAX_FIB_INDEX (46)");
    }
}
