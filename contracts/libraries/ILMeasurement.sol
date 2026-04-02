// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ILMeasurement
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Pure math library for measuring impermanent loss in constant-product pools
 * @dev IL is computed as the difference between hold value and LP position value.
 *
 *      For a constant product AMM (x*y=k):
 *        IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
 *
 *      Where priceRatio = currentPrice / entryPrice
 *
 *      This gives IL as a fraction (scaled by PRECISION). Always <= 0.
 *      Examples:
 *        priceRatio = 1.0  → IL = 0         (no divergence)
 *        priceRatio = 1.25 → IL ≈ -0.0060   (0.6% loss)
 *        priceRatio = 1.50 → IL ≈ -0.0204   (2.0% loss)
 *        priceRatio = 2.00 → IL ≈ -0.0572   (5.7% loss)
 *        priceRatio = 3.00 → IL ≈ -0.1340   (13.4% loss)
 *
 *      VibeSwap's batch auction mechanism reduces IL from toxic flow (MEV, frontrunning)
 *      but does NOT eliminate IL from macro price movements between batches. This library
 *      measures the actual IL so the fee controller can compensate LPs precisely.
 */
library ILMeasurement {
    uint256 constant PRECISION = 1e18;

    // ============ Core IL Computation ============

    /**
     * @notice Compute impermanent loss given a price ratio
     * @param priceRatio currentPrice / entryPrice, scaled by PRECISION
     * @return ilBps Impermanent loss in basis points (always positive — represents magnitude of loss)
     * @dev Uses the standard IL formula: IL = 1 - 2*sqrt(r)/(1+r)
     *      Result is in BPS (0 = no loss, 572 = 5.72% loss at 2x price)
     */
    function computeIL(uint256 priceRatio) internal pure returns (uint256 ilBps) {
        if (priceRatio == 0) return 0;
        if (priceRatio == PRECISION) return 0; // No divergence

        // IL = 1 - 2*sqrt(r) / (1 + r)
        // All math in PRECISION scale

        uint256 sqrtR = sqrt(priceRatio * PRECISION); // sqrt(r) * PRECISION
        uint256 numerator = 2 * sqrtR; // 2 * sqrt(r) * PRECISION
        uint256 denominator = PRECISION + priceRatio; // (1 + r) * implicit PRECISION

        // ratio = 2*sqrt(r) / (1+r), scaled by PRECISION
        uint256 ratio = (numerator * PRECISION) / denominator;

        // IL = 1 - ratio (if ratio < PRECISION, which it always is for r != 1)
        if (ratio >= PRECISION) return 0;
        uint256 ilFraction = PRECISION - ratio;

        // Convert to BPS: ilFraction / PRECISION * 10000
        ilBps = (ilFraction * 10000) / PRECISION;
    }

    /**
     * @notice Compute IL from actual reserve changes
     * @param reserve0Before Token0 reserves before period
     * @param reserve1Before Token1 reserves before period
     * @param reserve0After Token0 reserves after period
     * @param reserve1After Token1 reserves after period
     * @return ilBps Impermanent loss in basis points
     * @dev Derives price ratio from reserve changes using x*y=k invariant.
     *      price = reserve1/reserve0, so priceRatio = (r1After/r0After) / (r1Before/r0Before)
     */
    function computeILFromReserves(
        uint256 reserve0Before,
        uint256 reserve1Before,
        uint256 reserve0After,
        uint256 reserve1After
    ) internal pure returns (uint256 ilBps) {
        if (reserve0Before == 0 || reserve1Before == 0) return 0;
        if (reserve0After == 0 || reserve1After == 0) return 0;

        // priceBefore = reserve1Before / reserve0Before (scaled by PRECISION)
        // priceAfter = reserve1After / reserve0After (scaled by PRECISION)
        // priceRatio = priceAfter / priceBefore (scaled by PRECISION)

        // To avoid precision loss, compute ratio directly:
        // priceRatio = (r1After * r0Before) / (r0After * r1Before)
        uint256 numerator = reserve1After * reserve0Before;
        uint256 denominator = reserve0After * reserve1Before;

        uint256 priceRatio = (numerator * PRECISION) / denominator;

        return computeIL(priceRatio);
    }

    // ============ EWMA Smoothing ============

    /**
     * @notice Update exponentially weighted moving average of IL
     * @param currentEWMA Current smoothed IL value (BPS, scaled by PRECISION)
     * @param newSample New IL measurement (BPS)
     * @param alpha Smoothing factor (0-PRECISION). Higher = more weight on new sample.
     *              alpha = PRECISION/10 gives ~10% weight to new sample (smooth)
     *              alpha = PRECISION/2  gives ~50% weight to new sample (responsive)
     * @return Updated EWMA value (BPS, scaled by PRECISION)
     */
    function updateEWMA(
        uint256 currentEWMA,
        uint256 newSample,
        uint256 alpha
    ) internal pure returns (uint256) {
        // EWMA = alpha * newSample + (1 - alpha) * currentEWMA
        uint256 newComponent = alpha * newSample;
        uint256 oldComponent = (PRECISION - alpha) * currentEWMA;
        return (newComponent + oldComponent) / PRECISION;
    }

    // ============ Integer Square Root ============

    /**
     * @notice Babylonian integer square root
     * @param x Value to take sqrt of
     * @return y Floor of sqrt(x)
     */
    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
