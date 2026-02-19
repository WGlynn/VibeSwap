// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/libraries/BatchMath.sol";

// ============ Handler ============

contract MathHandler is Test {
    uint256 public reserve0 = 100 ether;
    uint256 public reserve1 = 100 ether;

    uint256 public ghost_totalFees;
    uint256 public ghost_swapCount;
    uint256 public ghost_productBefore;
    uint256 public ghost_productAfter;

    constructor() {
        ghost_productBefore = reserve0 * reserve1;
    }

    function doSwap(uint256 amountIn, bool zeroToOne) public {
        amountIn = bound(amountIn, 1 ether, 10 ether);
        uint256 feeRate = 30; // 0.3%

        uint256 rIn = zeroToOne ? reserve0 : reserve1;
        uint256 rOut = zeroToOne ? reserve1 : reserve0;

        ghost_productBefore = reserve0 * reserve1;

        uint256 out = BatchMath.getAmountOut(amountIn, rIn, rOut, feeRate);
        if (out == 0 || out >= rOut) return;

        if (zeroToOne) {
            reserve0 += amountIn;
            reserve1 -= out;
        } else {
            reserve1 += amountIn;
            reserve0 -= out;
        }

        ghost_productAfter = reserve0 * reserve1;
        ghost_swapCount++;

        (, uint256 lpFee) = BatchMath.calculateFees(amountIn, feeRate, 2500);
        ghost_totalFees += lpFee;
    }
}

// ============ Invariant Tests ============

contract BatchMathInvariantTest is StdInvariant, Test {
    MathHandler handler;

    function setUp() public {
        handler = new MathHandler();
        targetContract(address(handler));
    }

    // ============ Invariant: k never decreases (fees grow reserves) ============

    function invariant_kNeverDecreases() public view {
        // After any swap, reserve0 * reserve1 should be >= before
        // (because fees are taken from input, so effective input < actual input)
        if (handler.ghost_swapCount() > 0) {
            assertGe(handler.ghost_productAfter(), handler.ghost_productBefore());
        }
    }

    // ============ Invariant: reserves always positive ============

    function invariant_reservesAlwaysPositive() public view {
        assertGt(handler.reserve0(), 0);
        assertGt(handler.reserve1(), 0);
    }

    // ============ Invariant: fees are always non-negative ============

    function invariant_feesNonNegative() public view {
        assertGe(handler.ghost_totalFees(), 0);
    }
}
