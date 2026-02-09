// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title FibonacciScaling
 * @notice Fibonacci-based scaling for throughput bandwidth and price determination
 * @dev Uses Fibonacci sequence properties for natural, harmonic scaling
 *
 * Key mathematical properties leveraged:
 * - Golden ratio (φ ≈ 1.618): Optimal scaling factor found in nature
 * - Fibonacci retracement levels: 23.6%, 38.2%, 50%, 61.8%, 78.6%
 * - Fibonacci sequence for tier progression: 1, 1, 2, 3, 5, 8, 13, 21, 34, 55...
 *
 * Applications:
 * 1. Throughput bandwidth scaling - Progressive rate limits based on Fib tiers
 * 2. Price determination - Support/resistance levels at Fib retracement points
 * 3. Fee scaling - Golden ratio based fee adjustments
 * 4. Liquidity depth scoring - Fib-weighted liquidity bands
 */
library FibonacciScaling {
    // ============ Constants ============

    /// @notice Precision for fixed-point math (18 decimals)
    uint256 public constant PRECISION = 1e18;

    /// @notice Golden ratio (φ) = (1 + √5) / 2 ≈ 1.618033988749895
    /// @dev Stored as 1618033988749895000 (18 decimals)
    uint256 public constant PHI = 1618033988749895000;

    /// @notice Inverse golden ratio (1/φ) ≈ 0.618033988749895
    uint256 public constant PHI_INVERSE = 618033988749895000;

    /// @notice Fibonacci retracement levels (basis points, scaled to PRECISION)
    uint256 public constant FIB_236 = 236000000000000000;  // 23.6%
    uint256 public constant FIB_382 = 382000000000000000;  // 38.2%
    uint256 public constant FIB_500 = 500000000000000000;  // 50.0%
    uint256 public constant FIB_618 = 618000000000000000;  // 61.8%
    uint256 public constant FIB_786 = 786000000000000000;  // 78.6%

    /// @notice Maximum Fibonacci sequence index we precompute
    uint8 public constant MAX_FIB_INDEX = 46; // Fib(46) = 1,836,311,903 (fits in uint32)

    // ============ Structs ============

    /// @notice Fibonacci retracement levels between two price points
    struct FibRetracementLevels {
        uint256 level0;    // 0% (high)
        uint256 level236;  // 23.6%
        uint256 level382;  // 38.2%
        uint256 level500;  // 50.0%
        uint256 level618;  // 61.8%
        uint256 level786;  // 78.6%
        uint256 level1000; // 100% (low)
    }

    /// @notice Throughput tier configuration
    struct ThroughputTier {
        uint256 maxVolume;      // Maximum volume for this tier
        uint256 feeMultiplier;  // Fee multiplier (PRECISION = 1x)
        uint256 cooldownSeconds; // Cooldown between large trades
    }

    /// @notice Price band based on Fibonacci extensions
    struct FibPriceBand {
        uint256 support1;   // -23.6% extension
        uint256 support2;   // -38.2% extension
        uint256 pivot;      // Current price
        uint256 resist1;    // +23.6% extension
        uint256 resist2;    // +38.2% extension
    }

    // ============ Core Fibonacci Functions ============

    /**
     * @notice Calculate Fibonacci number at given index
     * @dev Uses iterative approach to avoid stack depth issues
     * @param n Index in Fibonacci sequence (0-indexed)
     * @return Fibonacci number at index n
     */
    function fibonacci(uint8 n) internal pure returns (uint256) {
        if (n == 0) return 0;
        if (n == 1 || n == 2) return 1;

        uint256 a = 1;
        uint256 b = 1;

        for (uint8 i = 3; i <= n; i++) {
            uint256 c = a + b;
            a = b;
            b = c;
        }

        return b;
    }

    /**
     * @notice Get sum of first n Fibonacci numbers
     * @dev Useful for cumulative tier calculations
     * @param n Number of Fibonacci numbers to sum
     * @return Sum of Fib(1) through Fib(n)
     */
    function fibonacciSum(uint8 n) internal pure returns (uint256) {
        if (n == 0) return 0;
        // Sum of first n Fibonacci numbers = Fib(n+2) - 1
        return fibonacci(n + 2) - 1;
    }

    /**
     * @notice Check if a number is a Fibonacci number
     * @dev Uses property: n is Fib iff (5*n² + 4) or (5*n² - 4) is perfect square
     * @param n Number to check
     * @return True if n is a Fibonacci number
     */
    function isFibonacci(uint256 n) internal pure returns (bool) {
        if (n == 0) return true;

        uint256 a = 5 * n * n + 4;
        uint256 b = 5 * n * n - 4;

        return _isPerfectSquare(a) || _isPerfectSquare(b);
    }

    // ============ Throughput Bandwidth Scaling ============

    /**
     * @notice Calculate throughput tier based on volume
     * @dev Tiers follow Fibonacci progression for natural scaling
     * @param volume Current trading volume
     * @param baseUnit Base unit for tier calculation
     * @return tier Tier index (0-based)
     * @return maxAllowed Maximum allowed volume for this tier
     * @return utilizationBps Utilization within tier (0-10000)
     */
    function getThroughputTier(
        uint256 volume,
        uint256 baseUnit
    ) internal pure returns (
        uint8 tier,
        uint256 maxAllowed,
        uint256 utilizationBps
    ) {
        uint256 accumulated = 0;

        for (uint8 i = 1; i <= MAX_FIB_INDEX; i++) {
            uint256 tierSize = fibonacci(i) * baseUnit;
            uint256 nextAccumulated = accumulated + tierSize;

            if (volume <= nextAccumulated) {
                tier = i - 1;
                maxAllowed = nextAccumulated;
                uint256 withinTier = volume > accumulated ? volume - accumulated : 0;
                utilizationBps = tierSize > 0 ? (withinTier * 10000) / tierSize : 0;
                return (tier, maxAllowed, utilizationBps);
            }

            accumulated = nextAccumulated;
        }

        // Beyond max tier
        tier = MAX_FIB_INDEX;
        maxAllowed = accumulated;
        utilizationBps = 10000;
    }

    /**
     * @notice Calculate fee multiplier based on Fibonacci tier
     * @dev Higher tiers (larger volumes) get progressively higher fees
     *      Fee grows with golden ratio: fee(n) = base * φ^(tier/3)
     * @param tier Current throughput tier
     * @param baseFee Base fee in basis points
     * @return adjustedFee Fee adjusted by Fibonacci scaling
     */
    function getFibonacciFeeMultiplier(
        uint8 tier,
        uint256 baseFee
    ) internal pure returns (uint256 adjustedFee) {
        if (tier == 0) return baseFee;

        // Scale fee using φ^(tier/3) approximation
        // For smooth scaling, we use: multiplier = 1 + (φ-1) * tier / 10
        uint256 multiplier = PRECISION + ((PHI - PRECISION) * tier) / 10;

        // Cap at 3x base fee
        if (multiplier > 3 * PRECISION) {
            multiplier = 3 * PRECISION;
        }

        adjustedFee = (baseFee * multiplier) / PRECISION;
    }

    /**
     * @notice Calculate rate limit based on Fibonacci bandwidth
     * @dev Bandwidth expands according to Fibonacci sequence
     * @param currentUsage Current usage in time window
     * @param maxBandwidth Maximum bandwidth limit
     * @param windowSeconds Time window for rate limiting
     * @return allowedAmount Maximum additional amount allowed
     * @return cooldownSeconds Required cooldown if limit hit
     */
    function calculateRateLimit(
        uint256 currentUsage,
        uint256 maxBandwidth,
        uint256 windowSeconds
    ) internal pure returns (
        uint256 allowedAmount,
        uint256 cooldownSeconds
    ) {
        if (currentUsage >= maxBandwidth) {
            // Cooldown based on inverse golden ratio
            cooldownSeconds = (windowSeconds * PHI_INVERSE) / PRECISION;
            return (0, cooldownSeconds);
        }

        uint256 remaining = maxBandwidth - currentUsage;

        // Apply Fibonacci damping as usage increases
        // allowedAmount decreases following inverse Fibonacci curve
        uint256 usageRatio = (currentUsage * PRECISION) / maxBandwidth;

        if (usageRatio < FIB_236) {
            // Under 23.6% usage: full remaining bandwidth
            allowedAmount = remaining;
        } else if (usageRatio < FIB_382) {
            // 23.6-38.2%: 78.6% of remaining
            allowedAmount = (remaining * FIB_786) / PRECISION;
        } else if (usageRatio < FIB_500) {
            // 38.2-50%: 61.8% of remaining
            allowedAmount = (remaining * FIB_618) / PRECISION;
        } else if (usageRatio < FIB_618) {
            // 50-61.8%: 50% of remaining
            allowedAmount = (remaining * FIB_500) / PRECISION;
        } else if (usageRatio < FIB_786) {
            // 61.8-78.6%: 38.2% of remaining
            allowedAmount = (remaining * FIB_382) / PRECISION;
        } else {
            // 78.6-100%: 23.6% of remaining
            allowedAmount = (remaining * FIB_236) / PRECISION;
        }

        cooldownSeconds = 0;
    }

    // ============ Price Determination ============

    /**
     * @notice Calculate Fibonacci retracement levels between high and low
     * @dev Standard Fibonacci retracement used in technical analysis
     * @param high Recent high price
     * @param low Recent low price
     * @return levels All standard Fibonacci retracement levels
     */
    function calculateRetracementLevels(
        uint256 high,
        uint256 low
    ) internal pure returns (FibRetracementLevels memory levels) {
        require(high >= low, "High must be >= low");

        uint256 range = high - low;

        levels.level0 = high;
        levels.level236 = high - (range * FIB_236) / PRECISION;
        levels.level382 = high - (range * FIB_382) / PRECISION;
        levels.level500 = high - (range * FIB_500) / PRECISION;
        levels.level618 = high - (range * FIB_618) / PRECISION;
        levels.level786 = high - (range * FIB_786) / PRECISION;
        levels.level1000 = low;
    }

    /**
     * @notice Calculate Fibonacci price bands around current price
     * @dev Extensions beyond current price for support/resistance
     * @param currentPrice Current market price
     * @param volatilityBps Recent volatility in basis points
     * @return bands Support and resistance levels
     */
    function calculatePriceBands(
        uint256 currentPrice,
        uint256 volatilityBps
    ) internal pure returns (FibPriceBand memory bands) {
        // Volatility determines band width
        uint256 bandWidth = (currentPrice * volatilityBps) / 10000;

        bands.pivot = currentPrice;

        // Support levels (below current price)
        bands.support1 = currentPrice - (bandWidth * FIB_236) / PRECISION;
        bands.support2 = currentPrice - (bandWidth * FIB_382) / PRECISION;

        // Resistance levels (above current price)
        bands.resist1 = currentPrice + (bandWidth * FIB_236) / PRECISION;
        bands.resist2 = currentPrice + (bandWidth * FIB_382) / PRECISION;
    }

    /**
     * @notice Determine if price is at a Fibonacci level
     * @dev Checks if current price is near any standard Fib level
     * @param currentPrice Current price
     * @param high Recent high
     * @param low Recent low
     * @param toleranceBps Tolerance in basis points
     * @return level Fib level hit (0, 236, 382, 500, 618, 786, 1000) or 9999 if none
     * @return isSupport True if price is at support (bouncing up)
     */
    function detectFibonacciLevel(
        uint256 currentPrice,
        uint256 high,
        uint256 low,
        uint256 toleranceBps
    ) internal pure returns (uint256 level, bool isSupport) {
        FibRetracementLevels memory levels = calculateRetracementLevels(high, low);

        // Check each level
        if (_isNear(currentPrice, levels.level0, toleranceBps)) {
            return (0, false); // At high (resistance)
        }
        if (_isNear(currentPrice, levels.level236, toleranceBps)) {
            return (236, currentPrice > levels.level236);
        }
        if (_isNear(currentPrice, levels.level382, toleranceBps)) {
            return (382, currentPrice > levels.level382);
        }
        if (_isNear(currentPrice, levels.level500, toleranceBps)) {
            return (500, currentPrice > levels.level500);
        }
        if (_isNear(currentPrice, levels.level618, toleranceBps)) {
            return (618, currentPrice > levels.level618);
        }
        if (_isNear(currentPrice, levels.level786, toleranceBps)) {
            return (786, currentPrice > levels.level786);
        }
        if (_isNear(currentPrice, levels.level1000, toleranceBps)) {
            return (1000, true); // At low (support)
        }

        return (9999, false); // No level detected
    }

    /**
     * @notice Calculate clearing price using Fibonacci-weighted average
     * @dev Weights bids/asks based on Fibonacci sequence for natural aggregation
     * @param prices Array of price points
     * @param volumes Array of volumes at each price
     * @return weightedPrice Fibonacci-weighted average price
     */
    function fibonacciWeightedPrice(
        uint256[] memory prices,
        uint256[] memory volumes
    ) internal pure returns (uint256 weightedPrice) {
        require(prices.length == volumes.length, "Array length mismatch");
        require(prices.length > 0, "Empty arrays");

        uint256 totalWeight = 0;
        uint256 weightedSum = 0;

        for (uint256 i = 0; i < prices.length; i++) {
            // Use Fibonacci number as weight (recent prices get higher weight)
            uint8 fibIndex = uint8(i < MAX_FIB_INDEX ? i + 1 : MAX_FIB_INDEX);
            uint256 weight = fibonacci(fibIndex) * volumes[i];

            weightedSum += prices[i] * weight;
            totalWeight += weight;
        }

        if (totalWeight == 0) return prices[0];

        weightedPrice = weightedSum / totalWeight;
    }

    /**
     * @notice Calculate golden ratio mean between two prices
     * @dev Useful for finding equilibrium price between bid and ask
     * @param price1 First price
     * @param price2 Second price
     * @return goldenMean Price at golden ratio point
     */
    function goldenRatioMean(
        uint256 price1,
        uint256 price2
    ) internal pure returns (uint256 goldenMean) {
        if (price1 > price2) {
            // Golden mean is closer to higher price
            uint256 range = price1 - price2;
            goldenMean = price2 + (range * PHI_INVERSE) / PRECISION;
        } else {
            uint256 range = price2 - price1;
            goldenMean = price1 + (range * PHI_INVERSE) / PRECISION;
        }
    }

    // ============ Liquidity Scoring ============

    /**
     * @notice Calculate liquidity depth using Fibonacci bands
     * @dev Scores liquidity based on how it's distributed across Fib levels
     * @param reserves Total reserves
     * @param currentPrice Current price
     * @param priceRange Price range for bands
     * @return score Liquidity score (0-100)
     */
    function calculateFibLiquidityScore(
        uint256 reserves,
        uint256 currentPrice,
        uint256 priceRange
    ) internal pure returns (uint256 score) {
        if (reserves == 0 || currentPrice == 0) return 0;

        // Score based on reserves relative to price * Fibonacci constant
        uint256 idealReserves = (currentPrice * PHI) / PRECISION;
        uint256 ratio = (reserves * PRECISION) / idealReserves;

        // Map to 0-100 score using Fibonacci levels
        if (ratio >= PRECISION) {
            score = 100; // At or above ideal
        } else if (ratio >= FIB_786) {
            score = 80 + ((ratio - FIB_786) * 20) / (PRECISION - FIB_786);
        } else if (ratio >= FIB_618) {
            score = 60 + ((ratio - FIB_618) * 20) / (FIB_786 - FIB_618);
        } else if (ratio >= FIB_500) {
            score = 40 + ((ratio - FIB_500) * 20) / (FIB_618 - FIB_500);
        } else if (ratio >= FIB_382) {
            score = 20 + ((ratio - FIB_382) * 20) / (FIB_500 - FIB_382);
        } else if (ratio >= FIB_236) {
            score = 10 + ((ratio - FIB_236) * 10) / (FIB_382 - FIB_236);
        } else {
            score = (ratio * 10) / FIB_236;
        }
    }

    // ============ Internal Helpers ============

    /**
     * @notice Check if a number is a perfect square
     */
    function _isPerfectSquare(uint256 n) internal pure returns (bool) {
        if (n == 0) return true;

        uint256 x = n;
        uint256 y = (x + 1) / 2;

        while (y < x) {
            x = y;
            y = (x + n / x) / 2;
        }

        return x * x == n;
    }

    /**
     * @notice Check if two values are within tolerance
     */
    function _isNear(
        uint256 value,
        uint256 target,
        uint256 toleranceBps
    ) internal pure returns (bool) {
        if (target == 0) return value == 0;

        uint256 tolerance = (target * toleranceBps) / 10000;
        uint256 lower = target > tolerance ? target - tolerance : 0;
        uint256 upper = target + tolerance;

        return value >= lower && value <= upper;
    }
}
