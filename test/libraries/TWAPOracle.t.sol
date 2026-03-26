// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/TWAPOracle.sol";

// ============ Harness ============

/// @notice Exposes TWAPOracle library functions via a stateful contract harness
contract TWAPHarness {
    TWAPOracle.OracleState public state;

    function initialize(uint256 initialPrice) external {
        TWAPOracle.initialize(state, initialPrice);
    }

    function write(uint256 price) external {
        TWAPOracle.write(state, price);
    }

    function grow(uint16 newCardinality) external {
        TWAPOracle.grow(state, newCardinality);
    }

    function consult(uint32 period) external view returns (uint256) {
        return TWAPOracle.consult(state, period);
    }

    function canConsult(uint32 period) external view returns (bool) {
        return TWAPOracle.canConsult(state, period);
    }

    function getIndex() external view returns (uint16) {
        return state.index;
    }

    function getCardinality() external view returns (uint16) {
        return state.cardinality;
    }

    function getCardinalityNext() external view returns (uint16) {
        return state.cardinalityNext;
    }

    function getObservation(uint16 idx)
        external
        view
        returns (uint32 timestamp, uint224 priceCumulative)
    {
        TWAPOracle.Observation memory obs = state.observations[idx];
        return (obs.timestamp, obs.priceCumulative);
    }
}

// ============ Tests ============

/**
 * @title TWAPOracleTest
 * @notice Unit tests for TWAPOracle library — initialization, price accumulation,
 *         TWAP calculation, staleness/period bounds, manipulation resistance, ring buffer
 */
contract TWAPOracleTest is Test {
    TWAPHarness public oracle;

    uint256 constant INITIAL_PRICE = 1e18; // 1.0 in 18-decimal fixed point
    uint32  constant MIN_PERIOD    = 5 minutes;
    uint32  constant MAX_PERIOD    = 24 hours;

    function setUp() public {
        // Start at a well-known timestamp that exceeds MAX_PERIOD so consult() never
        // underflows during "insufficient history" checks.
        vm.warp(2 days);
        oracle = new TWAPHarness();
        oracle.initialize(INITIAL_PRICE);
    }

    // ============ Initialization ============

    function test_initialize_setsFirstObservation() public view {
        (uint32 ts, uint224 cumulative) = oracle.getObservation(0);
        assertEq(ts, uint32(block.timestamp));
        // Initial cumulative is seeded with the initial price (not price*delta)
        assertEq(cumulative, uint224(INITIAL_PRICE));
    }

    function test_initialize_cardinality() public view {
        assertEq(oracle.getCardinality(), 1);
        assertEq(oracle.getCardinalityNext(), TWAPOracle.DEFAULT_CARDINALITY);
        assertEq(oracle.getIndex(), 0);
    }

    function test_initialize_differentPrice() public {
        TWAPHarness h = new TWAPHarness();
        h.initialize(2000e18);
        (, uint224 cumulative) = h.getObservation(0);
        assertEq(cumulative, uint224(2000e18));
    }

    // ============ Write ============

    function test_write_sameTimestampSkipped() public {
        // Second write in same block should be a no-op
        oracle.write(2e18);
        assertEq(oracle.getCardinality(), 1);
        assertEq(oracle.getIndex(), 0);
    }

    function test_write_advancesIndex() public {
        vm.warp(block.timestamp + 60);
        oracle.write(2e18);
        assertEq(oracle.getIndex(), 1);
        assertEq(oracle.getCardinality(), 2);
    }

    function test_write_accumulatesCumulative() public {
        uint256 startTime = block.timestamp;
        uint32 delta = 300; // 5 minutes
        vm.warp(startTime + delta);

        uint256 newPrice = 2e18;
        oracle.write(newPrice);

        // Expected: initialCumulative + price * delta
        uint224 expected = uint224(INITIAL_PRICE) + uint224(newPrice * delta);
        (, uint224 cumulative) = oracle.getObservation(1);
        assertEq(cumulative, expected);
    }

    function test_write_multiplePrices_accumulatesCorrectly() public {
        uint256 price1 = 1e18;
        uint256 price2 = 3e18;
        uint32 dt = 600;

        vm.warp(block.timestamp + dt);
        oracle.write(price1);

        vm.warp(block.timestamp + dt);
        oracle.write(price2);

        // cumulative[1] = initialCumulative + price1 * dt
        (, uint224 c1) = oracle.getObservation(1);
        assertEq(c1, uint224(INITIAL_PRICE) + uint224(price1 * dt));

        // cumulative[2] = c1 + price2 * dt
        (, uint224 c2) = oracle.getObservation(2);
        assertEq(c2, c1 + uint224(price2 * dt));
    }

    function test_write_rejectsOversizedPrice() public {
        // price so large that price * delta overflows uint224
        uint256 hugePrice = type(uint224).max; // > safe range with delta=1
        vm.warp(block.timestamp + 1);
        vm.expectRevert("M-07: Price too large for oracle");
        oracle.write(hugePrice);
    }

    // ============ Grow ============

    function test_grow_increasesCardinalityNext() public {
        oracle.grow(100);
        assertEq(oracle.getCardinalityNext(), 100);
    }

    function test_grow_doesNotShrink() public {
        oracle.grow(100);
        oracle.grow(50); // should not decrease
        assertEq(oracle.getCardinalityNext(), 100);
    }

    // ============ canConsult ============

    function test_canConsult_falseWithOneObservation() public view {
        // cardinality=1 => not enough history
        assertFalse(oracle.canConsult(MIN_PERIOD));
    }

    function test_canConsult_trueAfterSufficientHistory() public {
        // Write enough observations to cover MIN_PERIOD
        vm.warp(block.timestamp + MIN_PERIOD + 1);
        oracle.write(1e18);
        assertTrue(oracle.canConsult(MIN_PERIOD));
    }

    function test_canConsult_falseWhenTooRecent() public {
        // Write only 1 minute of history but ask for 5 minutes
        vm.warp(block.timestamp + 1 minutes);
        oracle.write(1e18);
        assertFalse(oracle.canConsult(MIN_PERIOD));
    }

    // ============ consult — period bounds ============

    function test_consult_rejectsPeriodTooShort() public {
        vm.expectRevert("Period too short");
        oracle.consult(MIN_PERIOD - 1);
    }

    function test_consult_rejectsPeriodTooLong() public {
        vm.expectRevert("Period too long");
        oracle.consult(MAX_PERIOD + 1);
    }

    // ============ consult — TWAP calculation ============

    function _buildHistory(uint256 price, uint32 step, uint8 count) internal {
        for (uint8 i = 0; i < count; i++) {
            vm.warp(block.timestamp + step);
            oracle.write(price);
        }
    }

    function test_consult_constantPrice_returnsSamePrice() public {
        uint256 p = 1e18;
        uint32 step = MIN_PERIOD / 5; // 60s steps, need 5+ steps to cover MIN_PERIOD
        _buildHistory(p, step, 10); // 600 s of history

        uint256 twap = oracle.consult(MIN_PERIOD);
        // TWAP of a constant price should equal that price
        assertApproxEqRel(twap, p, 1e15); // within 0.1%
    }

    function test_consult_risingPrice_twapBelowSpot() public {
        // Start low, end high — TWAP should lag spot
        uint32 step = MIN_PERIOD / 4; // 75 s per step
        uint256[8] memory prices = [
            uint256(1e18), 2e18, 3e18, 4e18,
            5e18, 6e18, 7e18, 8e18
        ];
        for (uint256 i = 0; i < prices.length; i++) {
            vm.warp(block.timestamp + step);
            oracle.write(prices[i]);
        }

        uint256 twap = oracle.consult(MIN_PERIOD);
        uint256 spotPrice = prices[prices.length - 1];
        // TWAP < spot when price is monotonically rising
        assertLt(twap, spotPrice);
        // TWAP > first price
        assertGt(twap, prices[0]);
    }

    function test_consult_insufficientHistory_reverts() public {
        // Only one observation — target time will be before oldest
        vm.warp(block.timestamp + 10); // tiny advance, << MIN_PERIOD
        oracle.write(1e18);
        vm.expectRevert(); // "OLD" or "TWAP: insufficient history"
        oracle.consult(MIN_PERIOD);
    }

    // ============ Manipulation resistance ============

    function test_manipulationResistance_singleSpike() public {
        // Normal history at 1e18
        uint32 step = MIN_PERIOD / 5;
        _buildHistory(1e18, step, 6); // 360s baseline

        uint256 preSpikeTwap = oracle.consult(MIN_PERIOD);

        // Attacker spikes price for one block
        vm.warp(block.timestamp + step);
        oracle.write(100e18); // 100x spike

        uint256 postSpikeTwap = oracle.consult(MIN_PERIOD);

        // Spike should have minimal effect: < 20x the baseline TWAP
        assertLt(postSpikeTwap, 20 * preSpikeTwap);
        // More precisely: since the spike lasts only one step out of
        // 5 steps in the window, weight ≈ 1/5 — TWAP should stay well below spike
        assertLt(postSpikeTwap, 50e18);
    }

    // ============ Ring buffer wrap-around ============

    function test_ringBuffer_wrapsCorrectly() public {
        uint16 cap = TWAPOracle.DEFAULT_CARDINALITY; // 10

        // Write cap+5 observations to force wrap
        for (uint16 i = 0; i < cap + 5; i++) {
            vm.warp(block.timestamp + 60);
            oracle.write(1e18);
        }

        // Index should have wrapped modulo cardinalityNext
        assertTrue(oracle.getIndex() < cap);
        // Cardinality should be at the cap
        assertEq(oracle.getCardinality(), cap);
    }

    function test_ringBuffer_twapStillValidAfterWrap() public {
        uint16 cap = TWAPOracle.DEFAULT_CARDINALITY;
        uint32 step = 60;

        // Fill beyond capacity
        for (uint16 i = 0; i < cap + 2; i++) {
            vm.warp(block.timestamp + step);
            oracle.write(1e18);
        }

        // Must be able to consult a MIN_PERIOD window (5 min = 300s = 5 steps)
        uint256 twap = oracle.consult(MIN_PERIOD);
        assertGt(twap, 0);
    }

    // ============ Fuzz ============

    function testFuzz_write_monotoneTimestamp(uint32 delta) public {
        vm.assume(delta > 0 && delta < 365 days);
        uint256 price = 1e18;
        // Safe price: price * delta < type(uint224).max
        vm.assume(price <= type(uint224).max / uint256(delta));

        uint32 before = uint32(block.timestamp);
        vm.warp(block.timestamp + delta);
        oracle.write(price);

        (uint32 ts, ) = oracle.getObservation(oracle.getIndex());
        assertGe(ts, before);
    }

    function testFuzz_consult_withinPriceBounds(uint256 price) public {
        // Keep price in safe range for oracle
        vm.assume(price >= 1e15 && price <= 1e24);

        uint32 step = MIN_PERIOD / 5;
        for (uint8 i = 0; i < 8; i++) {
            vm.warp(block.timestamp + step);
            oracle.write(price);
        }

        uint256 twap = oracle.consult(MIN_PERIOD);
        // TWAP of a constant price must equal that price (within rounding)
        assertApproxEqRel(twap, price, 1e15);
    }
}
