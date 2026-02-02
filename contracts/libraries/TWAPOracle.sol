// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TWAPOracle
 * @notice Time-Weighted Average Price oracle for manipulation resistance
 * @dev Stores price observations and calculates TWAP over configurable windows
 */
library TWAPOracle {
    // ============ Structs ============

    struct Observation {
        uint32 timestamp;
        uint224 priceCumulative;
    }

    struct OracleState {
        Observation[65535] observations; // Ring buffer of observations
        uint16 index;                     // Current index in ring buffer
        uint16 cardinality;               // Number of populated observations
        uint16 cardinalityNext;           // Target cardinality for growth
    }

    // ============ Constants ============

    uint256 constant PRECISION = 1e18;
    uint32 constant MIN_TWAP_PERIOD = 5 minutes;
    uint32 constant MAX_TWAP_PERIOD = 24 hours;

    // ============ Functions ============

    /**
     * @notice Initialize oracle state
     * @param state Oracle state to initialize
     * @param initialPrice Initial spot price (used to seed cumulative for immediate TWAP availability)
     */
    function initialize(
        OracleState storage state,
        uint256 initialPrice
    ) internal {
        // Seed with initial price so TWAP is immediately available
        // Use initialPrice * 1 second as initial cumulative value
        state.observations[0] = Observation({
            timestamp: uint32(block.timestamp),
            priceCumulative: uint224(initialPrice)
        });
        state.index = 0;
        state.cardinality = 1;
        state.cardinalityNext = 1;
    }

    /**
     * @notice Write a new price observation
     * @param state Oracle state
     * @param price Current spot price
     */
    function write(
        OracleState storage state,
        uint256 price
    ) internal {
        Observation memory last = state.observations[state.index];

        // Only write if time has passed
        if (block.timestamp == last.timestamp) return;

        uint32 delta = uint32(block.timestamp) - last.timestamp;

        // Calculate cumulative price (overflow is intentional for TWAP math)
        uint224 newCumulative = last.priceCumulative + uint224(price * delta);

        // Advance index
        uint16 indexNext = (state.index + 1) % state.cardinalityNext;

        state.observations[indexNext] = Observation({
            timestamp: uint32(block.timestamp),
            priceCumulative: newCumulative
        });

        state.index = indexNext;

        // Grow cardinality if needed
        if (state.cardinality < state.cardinalityNext) {
            state.cardinality++;
        }
    }

    /**
     * @notice Increase oracle cardinality for longer TWAP windows
     * @param state Oracle state
     * @param newCardinality Target cardinality
     */
    function grow(
        OracleState storage state,
        uint16 newCardinality
    ) internal {
        if (newCardinality > state.cardinalityNext) {
            state.cardinalityNext = newCardinality;
        }
    }

    /**
     * @notice Calculate TWAP over specified period
     * @param state Oracle state
     * @param period TWAP period in seconds
     * @return twap Time-weighted average price
     */
    function consult(
        OracleState storage state,
        uint32 period
    ) internal view returns (uint256 twap) {
        require(period >= MIN_TWAP_PERIOD, "Period too short");
        require(period <= MAX_TWAP_PERIOD, "Period too long");

        uint32 currentTime = uint32(block.timestamp);
        uint32 targetTime = currentTime - period;

        // Get current observation
        Observation memory current = state.observations[state.index];

        // Find observation at or before target time
        (Observation memory before, Observation memory after_) = getSurroundingObservations(
            state,
            targetTime
        );

        // Interpolate if needed
        uint224 targetCumulative;
        if (before.timestamp == targetTime) {
            targetCumulative = before.priceCumulative;
        } else {
            // Linear interpolation
            uint32 timeDelta = after_.timestamp - before.timestamp;
            uint224 priceDelta = after_.priceCumulative - before.priceCumulative;
            uint32 targetDelta = targetTime - before.timestamp;

            targetCumulative = before.priceCumulative +
                uint224((uint256(priceDelta) * targetDelta) / timeDelta);
        }

        // Calculate TWAP
        uint224 cumulativeDelta = current.priceCumulative - targetCumulative;
        uint32 twapTimeDelta = current.timestamp - targetTime;

        twap = uint256(cumulativeDelta) / twapTimeDelta;
    }

    /**
     * @notice Get observations surrounding a target timestamp
     */
    function getSurroundingObservations(
        OracleState storage state,
        uint32 target
    ) internal view returns (Observation memory before, Observation memory after_) {
        uint16 l = 0;
        uint16 r = state.cardinality - 1;
        uint16 i;

        // Binary search for target
        while (l < r) {
            i = (l + r + 1) / 2;
            uint16 actualIndex = (state.index + state.cardinality - i) % state.cardinality;

            if (state.observations[actualIndex].timestamp <= target) {
                r = i - 1;
            } else {
                l = i;
            }
        }

        uint16 beforeIndex = (state.index + state.cardinality - l) % state.cardinality;
        before = state.observations[beforeIndex];

        if (l == 0) {
            after_ = state.observations[state.index];
        } else {
            uint16 afterIndex = (state.index + state.cardinality - l + 1) % state.cardinality;
            after_ = state.observations[afterIndex];
        }

        require(before.timestamp <= target, "OLD");
    }

    /**
     * @notice Get oldest observation timestamp
     */
    function getOldestObservationTimestamp(
        OracleState storage state
    ) internal view returns (uint32) {
        uint16 oldestIndex = (state.index + 1) % state.cardinality;
        return state.observations[oldestIndex].timestamp;
    }

    /**
     * @notice Check if TWAP for period is available
     */
    function canConsult(
        OracleState storage state,
        uint32 period
    ) internal view returns (bool) {
        if (state.cardinality < 2) return false;

        uint32 oldestTimestamp = getOldestObservationTimestamp(state);
        uint32 targetTime = uint32(block.timestamp) - period;

        return oldestTimestamp <= targetTime;
    }
}
