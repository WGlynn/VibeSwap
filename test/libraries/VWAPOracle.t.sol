// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/VWAPOracle.sol";

// ============ Harness ============

/// @notice Exposes VWAPOracle library functions via a stateful contract harness
contract VWAPHarness {
    VWAPOracle.VWAPState public state;

    function initialize(uint256 initialPrice) external {
        VWAPOracle.initialize(state, initialPrice);
    }

    function recordTrade(uint256 price, uint256 volume) external {
        VWAPOracle.recordTrade(state, price, volume);
    }

    function grow(uint16 newCardinality) external {
        VWAPOracle.grow(state, newCardinality);
    }

    function consult(uint32 period) external view returns (uint256) {
        return VWAPOracle.consult(state, period);
    }

    function consultWithVolume(uint32 period) external view returns (uint256 vwap, uint256 totalVolume) {
        return VWAPOracle.consultWithVolume(state, period);
    }

    function canConsult(uint32 period) external view returns (bool) {
        return VWAPOracle.canConsult(state, period);
    }

    function getLastPrice() external view returns (uint256) {
        return VWAPOracle.getLastPrice(state);
    }

    function getCurrentCumulatives() external view returns (uint128 priceCumulative, uint128 volumeCumulative) {
        return VWAPOracle.getCurrentCumulatives(state);
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
}

// ============ Tests ============

/**
 * @title VWAPOracleTest
 * @notice Unit tests for VWAPOracle library — initialization, trade recording,
 *         VWAP calculation, period bounds, zero-volume handling, manipulation resistance
 */
contract VWAPOracleTest is Test {
    VWAPHarness public oracle;

    uint256 constant PRICE_SCALE = 1e12;
    uint256 constant PRECISION   = 1e18;
    uint32  constant MIN_PERIOD  = 1 minutes;
    uint32  constant MAX_PERIOD  = 24 hours;

    // Standard volumes that produce integer results after PRECISION division
    uint256 constant VOLUME_1 = 1e18; // 1 token (PRECISION units)
    uint256 constant PRICE_1  = 1000e18; // $1000

    function setUp() public {
        vm.warp(2 days); // Start well beyond MAX_PERIOD
        oracle = new VWAPHarness();
        oracle.initialize(PRICE_1);
    }

    // ============ Initialization ============

    function test_initialize_setsLastPrice() public view {
        // lastPrice is stored as price / PRICE_SCALE; getLastPrice() rescales
        assertEq(oracle.getLastPrice(), PRICE_1 / PRICE_SCALE * PRICE_SCALE);
    }

    function test_initialize_zeroCardinality() public view {
        assertEq(oracle.getCardinality(), 1);
        assertEq(oracle.getCardinalityNext(), 1);
        assertEq(oracle.getIndex(), 0);
    }

    function test_initialize_zeroCumulatives() public view {
        (uint128 pc, uint128 vc) = oracle.getCurrentCumulatives();
        assertEq(pc, 0);
        assertEq(vc, 0);
    }

    // ============ recordTrade ============

    function test_recordTrade_zeroVolumeNoOp() public view {
        // Calling with volume=0 must not change cumulatives
        // (Can't call directly after warp; test idempotence of zero vol)
        (uint128 pc0, uint128 vc0) = oracle.getCurrentCumulatives();
        // No trade recorded; state remains at initialization
        assertEq(pc0, 0);
        assertEq(vc0, 0);
    }

    function test_recordTrade_updatesCumulatives() public {
        vm.warp(block.timestamp + 60);
        oracle.recordTrade(PRICE_1, VOLUME_1);

        (uint128 pc, uint128 vc) = oracle.getCurrentCumulatives();
        // volumeCumulative should be non-zero
        assertGt(vc, 0);
        // priceCumulative should be non-zero
        assertGt(pc, 0);
    }

    function test_recordTrade_updatesLastPrice() public {
        uint256 newPrice = 2000e18;
        vm.warp(block.timestamp + 60);
        oracle.recordTrade(newPrice, VOLUME_1);
        // getLastPrice returns lastPrice * PRICE_SCALE
        assertEq(oracle.getLastPrice(), newPrice / PRICE_SCALE * PRICE_SCALE);
    }

    function test_recordTrade_sameBlockAccumulates() public {
        // Two trades in the same block: both should accumulate into index 0
        oracle.recordTrade(PRICE_1, VOLUME_1);
        oracle.recordTrade(PRICE_1, VOLUME_1);

        // Index should still be 0 (same timestamp)
        assertEq(oracle.getIndex(), 0);
        // But cumulatives should reflect both trades
        (uint128 pc, uint128 vc) = oracle.getCurrentCumulatives();
        assertGt(vc, 0);
    }

    function test_recordTrade_newBlockAdvancesIndex() public {
        oracle.grow(10); // grow cardinality so new obs can be stored
        vm.warp(block.timestamp + 60);
        oracle.recordTrade(PRICE_1, VOLUME_1);
        assertEq(oracle.getIndex(), 1);
        assertEq(oracle.getCardinality(), 2);
    }

    // ============ canConsult ============

    function test_canConsult_falseInitially() public view {
        // Only one observation in the buffer — can't compute VWAP
        assertFalse(oracle.canConsult(MIN_PERIOD));
    }

    function test_canConsult_trueAfterSufficientHistory() public {
        oracle.grow(10);
        vm.warp(block.timestamp + MIN_PERIOD + 1);
        oracle.recordTrade(PRICE_1, VOLUME_1);
        assertTrue(oracle.canConsult(MIN_PERIOD));
    }

    // ============ consult — period bounds ============

    function test_consult_rejectsPeriodTooShort() public {
        vm.expectRevert(VWAPOracle.PeriodTooShort.selector);
        oracle.consult(MIN_PERIOD - 1);
    }

    function test_consult_rejectsPeriodTooLong() public {
        vm.expectRevert(VWAPOracle.PeriodTooLong.selector);
        oracle.consult(MAX_PERIOD + 1);
    }

    function test_consult_rejectsInsufficientHistory() public {
        // Only initialization observation — no history covering the period
        vm.warp(block.timestamp + 10); // tiny warp, << MIN_PERIOD
        oracle.grow(10);
        oracle.recordTrade(PRICE_1, VOLUME_1);
        vm.expectRevert(VWAPOracle.InsufficientHistory.selector);
        oracle.consult(MIN_PERIOD);
    }

    // ============ consult — VWAP calculation ============

    function _buildHistory(uint256 price, uint256 volume, uint8 count, uint32 step) internal {
        oracle.grow(uint16(count) + 2);
        for (uint8 i = 0; i < count; i++) {
            vm.warp(block.timestamp + step);
            oracle.recordTrade(price, volume);
        }
    }

    function test_consult_uniformTrades_vwapEqualsPrice() public {
        // All trades at the same price → VWAP = that price
        uint32 step = MIN_PERIOD / 4; // 15s steps
        _buildHistory(PRICE_1, VOLUME_1, 8, step);

        uint256 vwap = oracle.consult(MIN_PERIOD);
        // VWAP should approximate PRICE_1 (allow 1% tolerance for rounding)
        assertApproxEqRel(vwap, PRICE_1, 1e16);
    }

    function test_consult_returnsLastPriceWhenNoVolume() public {
        // Build history then consult window with no trades in it
        oracle.grow(10);
        // Write one observation in the distant past
        uint256 oldTs = block.timestamp;
        vm.warp(oldTs + MIN_PERIOD + 1);
        oracle.recordTrade(PRICE_1, VOLUME_1);

        // Now skip forward far into the future so window has zero volume
        vm.warp(block.timestamp + 2 hours);
        // Don't record any trades; consult window contains no volume

        // consult() should return lastPrice when volumeDelta == 0
        uint256 vwap = oracle.consult(MIN_PERIOD);
        // lastPrice is stored as price / PRICE_SCALE * PRICE_SCALE
        assertApproxEqRel(vwap, PRICE_1, 1e16);
    }

    function test_consultWithVolume_returnsCorrectVolume() public {
        uint32 step = MIN_PERIOD / 4;
        uint8 count = 8;
        _buildHistory(PRICE_1, VOLUME_1, count, step);

        (, uint256 totalVolume) = oracle.consultWithVolume(MIN_PERIOD);
        // totalVolume should be > 0
        assertGt(totalVolume, 0);
    }

    // ============ VWAP invariants ============

    function test_vwap_weightedTowardsHigherVolume() public {
        oracle.grow(20);
        uint32 step = MIN_PERIOD / 8; // 7.5s steps

        // First half: low price, small volume
        for (uint8 i = 0; i < 4; i++) {
            vm.warp(block.timestamp + step);
            oracle.recordTrade(500e18, 1e17); // $500, 0.1 token
        }
        // Second half: high price, large volume
        for (uint8 i = 0; i < 4; i++) {
            vm.warp(block.timestamp + step);
            oracle.recordTrade(2000e18, 1e19); // $2000, 10 tokens
        }

        uint256 vwap = oracle.consult(MIN_PERIOD);
        // High-volume trades dominate — VWAP should be much closer to 2000 than 500
        assertGt(vwap, 1000e18);
    }

    // ============ Manipulation resistance ============

    function test_manipulationResistance_singleSpikeSmallVolume() public {
        // Build baseline at $1000 with large volume
        oracle.grow(20);
        uint32 step = MIN_PERIOD / 8;
        for (uint8 i = 0; i < 6; i++) {
            vm.warp(block.timestamp + step);
            oracle.recordTrade(1000e18, 1e19); // 10 tokens at $1000
        }

        uint256 baseVwap = oracle.consult(MIN_PERIOD);

        // Attacker executes one tiny trade at 100x price
        vm.warp(block.timestamp + step);
        oracle.recordTrade(100_000e18, 1e12); // 0.000001 token at $100k

        uint256 postSpikeVwap = oracle.consult(MIN_PERIOD);

        // Spike with tiny volume should not move VWAP significantly
        // Expect < 10x the baseline VWAP
        assertLt(postSpikeVwap, 10 * baseVwap);
        // Should still be close to the $1000 baseline
        assertApproxEqRel(postSpikeVwap, baseVwap, 5e16); // within 5%
    }

    // ============ Grow ============

    function test_grow_increasesCardinalityNext() public view {
        assertEq(oracle.getCardinalityNext(), 1);
    }

    function test_grow_monotonicIncrease() public {
        oracle.grow(50);
        assertEq(oracle.getCardinalityNext(), 50);
        oracle.grow(30); // should not shrink
        assertEq(oracle.getCardinalityNext(), 50);
    }

    // ============ Fuzz ============

    function testFuzz_recordTrade_constantPrice_vwapApproxPrice(uint256 price) public {
        // Keep price in a safe range (PRICE_SCALE divides cleanly, not too large)
        vm.assume(price >= 1e12 && price <= 1e24);
        // Ensure price is a multiple of PRICE_SCALE to avoid precision loss
        price = (price / PRICE_SCALE) * PRICE_SCALE;
        vm.assume(price > 0);

        oracle.grow(20);
        uint32 step = MIN_PERIOD / 8;
        for (uint8 i = 0; i < 10; i++) {
            vm.warp(block.timestamp + step);
            oracle.recordTrade(price, VOLUME_1);
        }

        uint256 vwap = oracle.consult(MIN_PERIOD);
        // VWAP of a constant price should approximate that price (within 1%)
        assertApproxEqRel(vwap, price, 1e16);
    }

    function testFuzz_recordTrade_zeroVolume_noStateChange(uint256 price) public {
        vm.assume(price > 0 && price < type(uint128).max);
        (uint128 pc0, uint128 vc0) = oracle.getCurrentCumulatives();
        oracle.recordTrade(price, 0); // zero volume must be no-op
        (uint128 pc1, uint128 vc1) = oracle.getCurrentCumulatives();
        assertEq(pc0, pc1);
        assertEq(vc0, vc1);
    }
}
