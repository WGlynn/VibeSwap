// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../oracles/interfaces/ITruePriceOracle.sol";

/**
 * @title TruePriceLib
 * @notice Validation helpers for True Price Oracle integration
 * @dev Provides utilities for price validation with stablecoin context awareness
 */
library TruePriceLib {
    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS_PRECISION = 10000;

    // ============ Errors ============

    error PriceDeviationTooHigh(uint256 spot, uint256 truePrice, uint256 deviationBps);
    error StalePrice(uint64 timestamp, uint256 maxAge);
    error ManipulationDetected(uint256 probability, uint256 threshold);

    // ============ Price Validation ============

    /**
     * @notice Validate that spot price is within acceptable range of True Price
     * @param spotPrice Current spot price
     * @param truePrice True Price estimate
     * @param maxDeviationBps Maximum allowed deviation in basis points
     * @return withinBounds True if price is acceptable
     */
    function validatePriceDeviation(
        uint256 spotPrice,
        uint256 truePrice,
        uint256 maxDeviationBps
    ) internal pure returns (bool withinBounds) {
        if (truePrice == 0) return true; // No reference, skip check

        uint256 deviation;
        if (spotPrice > truePrice) {
            deviation = ((spotPrice - truePrice) * BPS_PRECISION) / truePrice;
        } else {
            deviation = ((truePrice - spotPrice) * BPS_PRECISION) / truePrice;
        }

        return deviation <= maxDeviationBps;
    }

    /**
     * @notice Require spot price to be within acceptable range
     * @param spotPrice Current spot price
     * @param truePrice True Price estimate
     * @param maxDeviationBps Maximum allowed deviation
     */
    function requirePriceInRange(
        uint256 spotPrice,
        uint256 truePrice,
        uint256 maxDeviationBps
    ) internal pure {
        if (!validatePriceDeviation(spotPrice, truePrice, maxDeviationBps)) {
            uint256 deviation;
            if (spotPrice > truePrice) {
                deviation = ((spotPrice - truePrice) * BPS_PRECISION) / truePrice;
            } else {
                deviation = ((truePrice - spotPrice) * BPS_PRECISION) / truePrice;
            }
            revert PriceDeviationTooHigh(spotPrice, truePrice, deviation);
        }
    }

    /**
     * @notice Adjust max deviation based on stablecoin context
     * @param baseDeviationBps Base maximum deviation
     * @param usdtDominant Whether USDT is dominant
     * @param usdcDominant Whether USDC is dominant
     * @return adjustedDeviationBps Adjusted maximum deviation
     */
    function adjustDeviationForStablecoin(
        uint256 baseDeviationBps,
        bool usdtDominant,
        bool usdcDominant
    ) internal pure returns (uint256 adjustedDeviationBps) {
        if (usdtDominant) {
            // Tighter bounds during USDT-dominant (manipulation more likely)
            // 80% of normal bounds
            return (baseDeviationBps * 8000) / BPS_PRECISION;
        } else if (usdcDominant) {
            // Looser bounds during USDC-dominant (genuine trend more likely)
            // 120% of normal bounds
            return (baseDeviationBps * 12000) / BPS_PRECISION;
        }
        return baseDeviationBps;
    }

    /**
     * @notice Adjust max deviation based on regime
     * @param baseDeviationBps Base maximum deviation
     * @param regime Current market regime
     * @return adjustedDeviationBps Adjusted maximum deviation
     */
    function adjustDeviationForRegime(
        uint256 baseDeviationBps,
        ITruePriceOracle.RegimeType regime
    ) internal pure returns (uint256 adjustedDeviationBps) {
        if (regime == ITruePriceOracle.RegimeType.CASCADE) {
            // Very tight during cascades
            return (baseDeviationBps * 6000) / BPS_PRECISION; // 60%
        } else if (regime == ITruePriceOracle.RegimeType.MANIPULATION) {
            // Tight during manipulation
            return (baseDeviationBps * 7000) / BPS_PRECISION; // 70%
        } else if (regime == ITruePriceOracle.RegimeType.HIGH_LEVERAGE) {
            // Somewhat tight during high leverage
            return (baseDeviationBps * 8500) / BPS_PRECISION; // 85%
        } else if (regime == ITruePriceOracle.RegimeType.TREND) {
            // Looser during confirmed trends
            return (baseDeviationBps * 13000) / BPS_PRECISION; // 130%
        } else if (regime == ITruePriceOracle.RegimeType.LOW_VOLATILITY) {
            // Tighter during low volatility (smaller moves expected)
            return (baseDeviationBps * 7000) / BPS_PRECISION; // 70%
        }
        return baseDeviationBps; // NORMAL
    }

    // ============ Staleness Checks ============

    /**
     * @notice Check if True Price data is fresh
     * @param timestamp Data timestamp
     * @param maxAge Maximum acceptable age
     * @return fresh True if data is fresh
     */
    function isFresh(uint64 timestamp, uint256 maxAge) internal view returns (bool fresh) {
        if (timestamp == 0) return false;
        return block.timestamp <= timestamp + maxAge;
    }

    /**
     * @notice Require True Price data to be fresh
     * @param timestamp Data timestamp
     * @param maxAge Maximum acceptable age
     */
    function requireFresh(uint64 timestamp, uint256 maxAge) internal view {
        if (!isFresh(timestamp, maxAge)) {
            revert StalePrice(timestamp, maxAge);
        }
    }

    // ============ Manipulation Detection ============

    /**
     * @notice Check if manipulation probability exceeds threshold
     * @param manipulationProb Manipulation probability (18 decimals)
     * @param threshold Threshold (18 decimals)
     * @return likely True if manipulation likely
     */
    function isManipulationLikely(
        uint256 manipulationProb,
        uint256 threshold
    ) internal pure returns (bool likely) {
        return manipulationProb > threshold;
    }

    /**
     * @notice Require manipulation probability to be below threshold
     * @param manipulationProb Manipulation probability
     * @param threshold Maximum acceptable probability
     */
    function requireNoManipulation(
        uint256 manipulationProb,
        uint256 threshold
    ) internal pure {
        if (manipulationProb > threshold) {
            revert ManipulationDetected(manipulationProb, threshold);
        }
    }

    // ============ Z-Score Analysis ============

    /**
     * @notice Convert z-score to reversion probability
     * @dev Higher z-score = higher probability spot reverts to true price
     * @param zScore Deviation z-score (signed, 18 decimals)
     * @param usdtDominant Whether USDT is dominant (increases reversion probability)
     * @return probability Reversion probability (18 decimals)
     */
    function zScoreToReversionProbability(
        int256 zScore,
        bool usdtDominant
    ) internal pure returns (uint256 probability) {
        // Base probability from absolute z-score
        uint256 absZ = zScore >= 0 ? uint256(zScore) : uint256(-zScore);

        // Below 1 sigma: low reversion probability
        if (absZ < PRECISION) {
            return absZ / 4; // 0 to 0.25
        }

        // 1-2 sigma: moderate reversion probability
        if (absZ < 2 * PRECISION) {
            probability = PRECISION / 4 + ((absZ - PRECISION) * PRECISION / 4) / PRECISION;
            // 0.25 to 0.5
        }
        // 2-3 sigma: high reversion probability
        else if (absZ < 3 * PRECISION) {
            probability = PRECISION / 2 + ((absZ - 2 * PRECISION) * PRECISION / 3) / PRECISION;
            // 0.5 to 0.83
        }
        // >3 sigma: very high reversion probability
        else {
            probability = (PRECISION * 83) / 100 + ((absZ - 3 * PRECISION) * PRECISION / 10) / PRECISION;
            // 0.83 to 0.93 (capped)
            if (probability > (PRECISION * 93) / 100) {
                probability = (PRECISION * 93) / 100;
            }
        }

        // USDT-dominant: increase reversion probability by 10%
        if (usdtDominant) {
            probability = probability + (probability / 10);
            if (probability > PRECISION) probability = PRECISION;
        }

        return probability;
    }

    // ============ Utility Functions ============

    /**
     * @notice Compute absolute value of signed integer
     * @param x Signed integer
     * @return Absolute value
     */
    function abs(int256 x) internal pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    /**
     * @notice Compute percentage in basis points
     * @param amount Base amount
     * @param bps Basis points
     * @return result Amount * bps / 10000
     */
    function bpsOf(uint256 amount, uint256 bps) internal pure returns (uint256 result) {
        return (amount * bps) / BPS_PRECISION;
    }
}
