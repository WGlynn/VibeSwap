// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/TWAPOracle.sol";

contract TWAPOracleHandler is Test {
    using TWAPOracle for TWAPOracle.OracleState;
    TWAPOracle.OracleState internal _state;

    uint256 public writeCount;
    uint256 public lastWriteTimestamp;
    uint256 public lastPrice;

    constructor() {
        vm.warp(1000);
        _state.initialize(1e18);
        _state.grow(100);
        lastWriteTimestamp = block.timestamp;
        lastPrice = 1e18;
    }

    function write(uint256 price) external {
        price = bound(price, 1, 1e24);
        uint256 timeJump = bound(price, 1, 600); // reuse seed for time
        vm.warp(block.timestamp + timeJump);

        _state.write(price);
        writeCount++;
        lastWriteTimestamp = block.timestamp;
        lastPrice = price;
    }

    function grow(uint16 newCard) external {
        newCard = uint16(bound(newCard, 1, 500));
        _state.grow(newCard);
    }

    function getIndex() external view returns (uint16) { return _state.index; }
    function getCardinality() external view returns (uint16) { return _state.cardinality; }
    function getCardinalityNext() external view returns (uint16) { return _state.cardinalityNext; }
}

contract TWAPOracleInvariantTest is Test {
    TWAPOracleHandler handler;

    function setUp() public {
        handler = new TWAPOracleHandler();
        targetContract(address(handler));
    }

    // ============ Invariant: cardinality never decreases ============
    function invariant_cardinality_neverDecreases() public view {
        assertGe(handler.getCardinalityNext(), handler.getCardinality(), "cardinalityNext >= cardinality");
        assertGe(handler.getCardinality(), 1, "cardinality >= 1 after init");
    }

    // ============ Invariant: index stays within cardinality ============
    function invariant_index_withinCardinality() public view {
        uint16 index = handler.getIndex();
        uint16 cardinality = handler.getCardinality();
        assertLt(index, cardinality == 0 ? 1 : cardinality, "index < cardinality");
    }
}
