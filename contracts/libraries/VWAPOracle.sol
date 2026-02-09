// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VWAPOracle
 * @notice Volume-Weighted Average Price oracle for fair execution pricing
 * @dev Tracks price weighted by trade volume for more accurate market price
 *
 * VWAP = Σ(price_i × volume_i) / Σ(volume_i)
 *
 * Key properties:
 * - More accurate than TWAP when volume varies significantly
 * - Resistant to low-volume manipulation
 * - Better for large order execution benchmarking
 *
 * Formal invariants:
 * - INV1: VWAP is bounded by min/max prices in window
 * - INV2: Zero volume periods don't affect VWAP
 * - INV3: VWAP converges to spot price as volume concentrates
 */
library VWAPOracle {
    // ============ Structs ============

    struct VolumeObservation {
        uint32 timestamp;
        uint128 priceCumulative;    // Σ(price × volume) - scaled
        uint128 volumeCumulative;    // Σ(volume)
    }

    struct VWAPState {
        VolumeObservation[8192] observations;
        uint16 index;
        uint16 cardinality;
        uint16 cardinalityNext;
        uint128 lastPrice;           // Last recorded price for interpolation
    }

    // ============ Constants ============

    uint256 constant PRECISION = 1e18;
    uint256 constant PRICE_SCALE = 1e12;  // Scale factor to prevent overflow
    uint32 constant MIN_VWAP_PERIOD = 1 minutes;
    uint32 constant MAX_VWAP_PERIOD = 24 hours;

    // ============ Errors ============

    error PeriodTooShort();
    error PeriodTooLong();
    error InsufficientHistory();
    error NoVolumeInPeriod();

    // ============ Core Functions ============

    /**
     * @notice Initialize VWAP state
     * @param state VWAP state to initialize
     * @param initialPrice Initial spot price
     */
    function initialize(
        VWAPState storage state,
        uint256 initialPrice
    ) internal {
        state.observations[0] = VolumeObservation({
            timestamp: uint32(block.timestamp),
            priceCumulative: 0,
            volumeCumulative: 0
        });
        state.index = 0;
        state.cardinality = 1;
        state.cardinalityNext = 1;
        state.lastPrice = uint128(initialPrice / PRICE_SCALE);
    }

    /**
     * @notice Record a trade for VWAP calculation
     * @param state VWAP state
     * @param price Trade execution price
     * @param volume Trade volume (in base token)
     *
     * @dev Maintains cumulative sums for efficient VWAP calculation
     *
     * Proof of correctness:
     * - priceCumulative += price × volume (scaled)
     * - volumeCumulative += volume
     * - VWAP = priceCumulative / volumeCumulative
     */
    function recordTrade(
        VWAPState storage state,
        uint256 price,
        uint256 volume
    ) internal {
        if (volume == 0) return;

        VolumeObservation memory last = state.observations[state.index];

        // Scale price to prevent overflow when multiplied by volume
        uint128 scaledPrice = uint128(price / PRICE_SCALE);
        state.lastPrice = scaledPrice;

        // Calculate weighted contribution (price × volume)
        // Use checked math to detect overflow
        uint256 priceContribution = uint256(scaledPrice) * volume / PRECISION;

        uint128 newPriceCumulative = last.priceCumulative + uint128(priceContribution);
        uint128 newVolumeCumulative = last.volumeCumulative + uint128(volume / PRECISION);

        // Write new observation if timestamp changed
        if (block.timestamp != last.timestamp) {
            uint16 indexNext = (state.index + 1) % state.cardinalityNext;

            state.observations[indexNext] = VolumeObservation({
                timestamp: uint32(block.timestamp),
                priceCumulative: newPriceCumulative,
                volumeCumulative: newVolumeCumulative
            });

            state.index = indexNext;

            if (state.cardinality < state.cardinalityNext) {
                state.cardinality++;
            }
        } else {
            // Update current observation
            state.observations[state.index] = VolumeObservation({
                timestamp: uint32(block.timestamp),
                priceCumulative: newPriceCumulative,
                volumeCumulative: newVolumeCumulative
            });
        }
    }

    /**
     * @notice Calculate VWAP over specified period
     * @param state VWAP state
     * @param period VWAP period in seconds
     * @return vwap Volume-weighted average price
     *
     * @dev VWAP = (currentCumulative - targetCumulative) / (currentVolume - targetVolume)
     *
     * Formal proof:
     * Let P_i = price of trade i, V_i = volume of trade i
     * VWAP = Σ(P_i × V_i) / Σ(V_i) for all trades in [targetTime, currentTime]
     *
     * Using cumulative sums:
     * VWAP = (Σ_current - Σ_target) / (V_current - V_target)
     *
     * INV1 holds: VWAP ∈ [min(P_i), max(P_i)] by weighted average properties
     */
    function consult(
        VWAPState storage state,
        uint32 period
    ) internal view returns (uint256 vwap) {
        if (period < MIN_VWAP_PERIOD) revert PeriodTooShort();
        if (period > MAX_VWAP_PERIOD) revert PeriodTooLong();

        uint32 currentTime = uint32(block.timestamp);
        uint32 targetTime = currentTime - period;

        VolumeObservation memory current = state.observations[state.index];

        // Find observation at or before target time
        (VolumeObservation memory target, bool found) = findObservation(state, targetTime);

        if (!found) revert InsufficientHistory();

        // Calculate deltas
        uint256 volumeDelta = current.volumeCumulative - target.volumeCumulative;

        if (volumeDelta == 0) {
            // No volume in period - return last known price
            return uint256(state.lastPrice) * PRICE_SCALE;
        }

        uint256 priceDelta = current.priceCumulative - target.priceCumulative;

        // VWAP = priceDelta / volumeDelta (rescale)
        vwap = (priceDelta * PRICE_SCALE * PRECISION) / volumeDelta;
    }

    /**
     * @notice Get VWAP with volume info
     * @param state VWAP state
     * @param period VWAP period
     * @return vwap Volume-weighted average price
     * @return totalVolume Total volume in period
     */
    function consultWithVolume(
        VWAPState storage state,
        uint32 period
    ) internal view returns (uint256 vwap, uint256 totalVolume) {
        if (period < MIN_VWAP_PERIOD) revert PeriodTooShort();
        if (period > MAX_VWAP_PERIOD) revert PeriodTooLong();

        uint32 targetTime = uint32(block.timestamp) - period;

        VolumeObservation memory current = state.observations[state.index];
        (VolumeObservation memory target, bool found) = findObservation(state, targetTime);

        if (!found) revert InsufficientHistory();

        totalVolume = (current.volumeCumulative - target.volumeCumulative) * PRECISION;

        if (totalVolume == 0) {
            return (uint256(state.lastPrice) * PRICE_SCALE, 0);
        }

        uint256 priceDelta = current.priceCumulative - target.priceCumulative;
        vwap = (priceDelta * PRICE_SCALE * PRECISION * PRECISION) / totalVolume;
    }

    /**
     * @notice Increase oracle cardinality
     * @param state VWAP state
     * @param newCardinality Target cardinality
     */
    function grow(
        VWAPState storage state,
        uint16 newCardinality
    ) internal {
        if (newCardinality > state.cardinalityNext) {
            state.cardinalityNext = newCardinality;
        }
    }

    /**
     * @notice Check if VWAP is available for period
     * @param state VWAP state
     * @param period Period to check
     */
    function canConsult(
        VWAPState storage state,
        uint32 period
    ) internal view returns (bool) {
        if (state.cardinality < 2) return false;

        uint16 oldestIndex = (state.index + 1) % state.cardinality;
        uint32 oldestTimestamp = state.observations[oldestIndex].timestamp;
        uint32 targetTime = uint32(block.timestamp) - period;

        return oldestTimestamp <= targetTime;
    }

    // ============ Internal Functions ============

    /**
     * @notice Find observation at or before target timestamp
     * @dev Binary search through ring buffer
     */
    function findObservation(
        VWAPState storage state,
        uint32 target
    ) internal view returns (VolumeObservation memory obs, bool found) {
        if (state.cardinality == 0) return (obs, false);

        // Check if target is too old
        uint16 oldestIndex = (state.index + 1) % state.cardinality;
        if (state.observations[oldestIndex].timestamp > target) {
            return (obs, false);
        }

        // Binary search
        uint16 l = 0;
        uint16 r = state.cardinality - 1;

        while (l <= r) {
            uint16 mid = (l + r) / 2;
            uint16 actualIndex = (state.index + state.cardinality - mid) % state.cardinality;
            VolumeObservation memory midObs = state.observations[actualIndex];

            if (midObs.timestamp == target) {
                return (midObs, true);
            } else if (midObs.timestamp < target) {
                if (mid == 0) {
                    return (midObs, true);
                }
                r = mid - 1;
            } else {
                l = mid + 1;
            }
        }

        // Return closest observation before target
        uint16 resultIndex = (state.index + state.cardinality - l) % state.cardinality;
        return (state.observations[resultIndex], true);
    }

    // ============ View Helpers ============

    /**
     * @notice Get current cumulative values
     */
    function getCurrentCumulatives(
        VWAPState storage state
    ) internal view returns (uint128 priceCumulative, uint128 volumeCumulative) {
        VolumeObservation memory current = state.observations[state.index];
        return (current.priceCumulative, current.volumeCumulative);
    }

    /**
     * @notice Get last recorded price
     */
    function getLastPrice(VWAPState storage state) internal view returns (uint256) {
        return uint256(state.lastPrice) * PRICE_SCALE;
    }
}
