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
    /// @notice Default cardinality for new pools (allows TWAP to bootstrap automatically)
    uint16 constant DEFAULT_CARDINALITY = 10;

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
        // Auto-grow to DEFAULT_CARDINALITY so subsequent write() calls
        // actually accumulate distinct observations. Without this,
        // cardinalityNext=1 causes write() to overwrite index 0 forever,
        // leaving cardinality stuck at 1 and all TWAP validation disabled.
        state.cardinalityNext = DEFAULT_CARDINALITY;
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

        // M-07 DISSOLVED: Validate price*delta won't silently truncate when cast to uint224.
        // Uniswap V2 wrapping is intentional for cumulative values, but the cast itself
        // must not truncate — truncation corrupts the TWAP calculation permanently.
        // Max uint224 ≈ 2.7e67. With price=1e30 and delta=86400, product=8.64e34 (safe).
        // With price=1e40 and delta=86400, product=8.64e44 (safe). Only exotic edge cases fail.
        require(price <= type(uint224).max / (delta > 0 ? delta : 1), "M-07: Price too large for oracle");
        uint224 newCumulative;
        unchecked {
            newCumulative = last.priceCumulative + uint224(price * delta);
        }

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

        // Guard against underflow when block.timestamp < period
        require(currentTime >= period, "TWAP: insufficient history");

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
        } else if (before.timestamp == after_.timestamp) {
            // Degenerate case: getSurroundingObservations returned the same observation
            // for both before and after_ (target is at or after newest). Use the
            // cumulative directly — this is the best approximation available.
            targetCumulative = before.priceCumulative;
        } else {
            // Linear interpolation
            uint32 timeDelta = after_.timestamp - before.timestamp;

            // Use unchecked for cumulative price delta — TWAP math (like Uniswap V2)
            // relies on wrapping arithmetic for cumulative values.
            uint224 priceDelta;
            unchecked {
                priceDelta = after_.priceCumulative - before.priceCumulative;
            }
            uint32 targetDelta = targetTime - before.timestamp;

            targetCumulative = before.priceCumulative +
                uint224((uint256(priceDelta) * targetDelta) / timeDelta);
        }

        // Calculate TWAP — use unchecked for cumulative subtraction (wrapping math)
        uint224 cumulativeDelta;
        unchecked {
            cumulativeDelta = current.priceCumulative - targetCumulative;
        }
        uint32 twapTimeDelta = current.timestamp - targetTime;

        // Guard against div-by-zero when current timestamp equals target
        require(twapTimeDelta > 0, "TWAP: no time elapsed");
        twap = uint256(cumulativeDelta) / twapTimeDelta;
    }

    /**
     * @notice Get observations surrounding a target timestamp
     * @dev Binary search from oldest to newest. Returns (before, after_) such that
     *      before.timestamp <= target < after_.timestamp for interpolation.
     */
    function getSurroundingObservations(
        OracleState storage state,
        uint32 target
    ) internal view returns (Observation memory before, Observation memory after_) {
        // Newest observation
        Observation memory newest = state.observations[state.index];

        // If target is at or after the newest observation, return it directly
        // (consult() will use it as both the cumulative reference and current)
        if (newest.timestamp <= target) {
            return (newest, newest);
        }

        // Oldest observation in the ring buffer
        uint16 oldestIdx = (state.index + 1) % state.cardinality;
        Observation memory oldest = state.observations[oldestIdx];

        // If target is before the oldest observation, we can't compute TWAP
        require(oldest.timestamp <= target, "OLD");

        // Binary search: find the last observation with timestamp <= target
        // Search space: offsets 0..cardinality-1 from oldestIdx (chronological order)
        uint16 l = 0;
        uint16 r = state.cardinality - 1;

        while (l < r) {
            uint16 mid = (l + r + 1) / 2; // Bias high to find rightmost match
            uint16 midIdx = (oldestIdx + mid) % state.cardinality;

            if (state.observations[midIdx].timestamp <= target) {
                l = mid; // This observation is at or before target, keep it
            } else {
                r = mid - 1; // This observation is after target, exclude it
            }
        }

        // l is the offset of the last observation with timestamp <= target
        uint16 beforeIdx = (oldestIdx + l) % state.cardinality;
        before = state.observations[beforeIdx];

        // after_ is the next observation (which has timestamp > target)
        uint16 afterIdx = (oldestIdx + l + 1) % state.cardinality;
        after_ = state.observations[afterIdx];
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

        uint32 currentTime = uint32(block.timestamp);

        // Guard: if current time is less than period, TWAP window extends before
        // genesis — not enough history by definition.
        if (currentTime < period) return false;

        uint32 oldestTimestamp = getOldestObservationTimestamp(state);
        uint32 targetTime = currentTime - period;

        // Oldest observation must be at or before the target time
        if (oldestTimestamp > targetTime) return false;

        // Newest observation must be at or after the target time to avoid
        // degenerate interpolation (both surrounding observations identical).
        // Without this, consult() may encounter a zero time delta when the
        // oracle hasn't been updated recently enough to cover the TWAP window.
        uint32 newestTimestamp = state.observations[state.index].timestamp;
        if (newestTimestamp < targetTime) return false;

        return true;
    }
}
