// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/TWAPOracle.sol";

// Wrapper with storage to test library
contract TWAPWrapper {
    TWAPOracle.OracleState internal state;

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

    function getOldestObservationTimestamp() external view returns (uint32) {
        return TWAPOracle.getOldestObservationTimestamp(state);
    }

    function getIndex() external view returns (uint16) { return state.index; }
    function getCardinality() external view returns (uint16) { return state.cardinality; }
    function getCardinalityNext() external view returns (uint16) { return state.cardinalityNext; }
}

contract TWAPOracleTest is Test {
    TWAPWrapper oracle;

    uint256 constant INITIAL_PRICE = 1000e18; // $1000

    function setUp() public {
        vm.warp(100_000); // Start at reasonable timestamp
        oracle = new TWAPWrapper();
        oracle.initialize(INITIAL_PRICE);
    }

    // ============ Initialize ============

    function test_initialize_setsState() public view {
        assertEq(oracle.getCardinality(), 1);
        assertEq(oracle.getCardinalityNext(), 10); // DEFAULT_CARDINALITY auto-bootstrap
        assertEq(oracle.getIndex(), 0);
    }

    // ============ Write ============

    function test_write_addsObservation() public {
        oracle.grow(10); // Allow more observations
        vm.warp(100_060); // +60 seconds
        oracle.write(1010e18);

        assertEq(oracle.getCardinality(), 2);
        assertEq(oracle.getIndex(), 1);
    }

    function test_write_skipsSameTimestamp() public {
        oracle.grow(10);
        oracle.write(1010e18); // Same timestamp as initialize

        // Should not have advanced
        assertEq(oracle.getCardinality(), 1);
        assertEq(oracle.getIndex(), 0);
    }

    function test_write_multipleObservations() public {
        oracle.grow(100);

        for (uint256 i = 1; i <= 10; i++) {
            vm.warp(100_000 + i * 60);
            oracle.write(INITIAL_PRICE + i * 10e18);
        }

        assertEq(oracle.getCardinality(), 11); // initial + 10 writes
    }

    // ============ Grow ============

    function test_grow_increasesCardinalityNext() public {
        oracle.grow(100);
        assertEq(oracle.getCardinalityNext(), 100);
    }

    function test_grow_doesNotDecrease() public {
        oracle.grow(100);
        oracle.grow(50);
        assertEq(oracle.getCardinalityNext(), 100); // Stays at max
    }

    // ============ canConsult ============

    function test_canConsult_falseWithOneObservation() public view {
        assertFalse(oracle.canConsult(5 minutes));
    }

    function test_canConsult_trueWithSufficientHistory() public {
        oracle.grow(100);

        // Write observations over 10 minutes
        for (uint256 i = 1; i <= 10; i++) {
            vm.warp(100_000 + i * 60);
            oracle.write(INITIAL_PRICE);
        }

        assertTrue(oracle.canConsult(5 minutes));
    }

    // ============ consult ============

    function test_consult_stablePrice() public {
        oracle.grow(100);

        // Write stable price over 10 minutes
        for (uint256 i = 1; i <= 20; i++) {
            vm.warp(100_000 + i * 30);
            oracle.write(INITIAL_PRICE);
        }

        assertTrue(oracle.canConsult(5 minutes));
        uint256 twap = oracle.consult(5 minutes);
        // TWAP of constant price should equal that price
        assertEq(twap, INITIAL_PRICE);
    }

    function test_consult_risingPrice() public {
        oracle.grow(100);

        // Write rising price over 10 minutes
        for (uint256 i = 1; i <= 20; i++) {
            vm.warp(100_000 + i * 30);
            oracle.write(INITIAL_PRICE + i * 10e18);
        }

        assertTrue(oracle.canConsult(5 minutes));
        uint256 twap = oracle.consult(5 minutes);
        // TWAP should be between start and end price
        assertGt(twap, INITIAL_PRICE);
        assertLt(twap, INITIAL_PRICE + 20 * 10e18);
    }

    function test_consult_exactTimestampMatch() public {
        oracle.grow(100);

        // Write at exact 30-second intervals
        for (uint256 i = 1; i <= 20; i++) {
            vm.warp(100_000 + i * 30);
            oracle.write(INITIAL_PRICE);
        }

        // Query with period that lands exactly on an observation timestamp
        // 10 minutes = 600s, current time = 100_600
        assertTrue(oracle.canConsult(5 minutes));
        uint256 twap = oracle.consult(5 minutes);
        assertEq(twap, INITIAL_PRICE);
    }

    function test_consult_revertsIfPeriodTooShort() public {
        oracle.grow(100);
        vm.warp(100_300);
        oracle.write(INITIAL_PRICE);

        vm.expectRevert("Period too short");
        oracle.consult(1 minutes); // Below MIN_TWAP_PERIOD (5 min)
    }

    function test_consult_revertsIfPeriodTooLong() public {
        oracle.grow(100);
        vm.warp(100_300);
        oracle.write(INITIAL_PRICE);

        vm.expectRevert("Period too long");
        oracle.consult(25 hours); // Above MAX_TWAP_PERIOD (24 hours)
    }

    // ============ getOldestObservationTimestamp ============

    function test_getOldestTimestamp_afterInit() public view {
        // With cardinality 1, oldest = observations[(0+1) % 1] = observations[0]
        assertEq(oracle.getOldestObservationTimestamp(), 100_000);
    }

    function test_getOldestTimestamp_afterWrites() public {
        oracle.grow(5);

        vm.warp(100_060);
        oracle.write(INITIAL_PRICE);

        vm.warp(100_120);
        oracle.write(INITIAL_PRICE);

        // Oldest should be the first observation
        uint32 oldest = oracle.getOldestObservationTimestamp();
        assertLe(oldest, 100_060);
    }
}
