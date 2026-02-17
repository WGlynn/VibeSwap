// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/amm/curves/ConstantProductCurve.sol";

contract ConstantProductCurveFuzzTest is Test {
    ConstantProductCurve public curve;

    function setUp() public {
        curve = new ConstantProductCurve();
    }

    /// @notice Output is always less than reserveOut
    function testFuzz_outputLessThanReserve(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public view {
        amountIn = bound(amountIn, 1, 1e24);
        reserveIn = bound(reserveIn, 1e6, 1e30);
        reserveOut = bound(reserveOut, 1e6, 1e30);

        uint256 out = curve.getAmountOut(amountIn, reserveIn, reserveOut, 0, "");
        assertLt(out, reserveOut);
    }

    /// @notice K (x*y) never decreases after swap
    function testFuzz_kNeverDecreases(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public view {
        amountIn = bound(amountIn, 1, 1e20);
        reserveIn = bound(reserveIn, 1e10, 1e26);
        reserveOut = bound(reserveOut, 1e10, 1e26);

        uint256 out = curve.getAmountOut(amountIn, reserveIn, reserveOut, 0, "");
        if (out == 0) return;

        uint256 kBefore = reserveIn * reserveOut;
        uint256 kAfter = (reserveIn + amountIn) * (reserveOut - out);
        assertGe(kAfter, kBefore);
    }

    /// @notice Fees always reduce output
    function testFuzz_feesReduceOutput(uint256 amountIn, uint256 feeRate) public view {
        amountIn = bound(amountIn, 1e12, 1e22);
        feeRate = bound(feeRate, 1, 1000); // 0.01% to 10%

        uint256 outNoFee = curve.getAmountOut(amountIn, 1e24, 1e24, 0, "");
        uint256 outFee = curve.getAmountOut(amountIn, 1e24, 1e24, feeRate, "");

        assertGt(outNoFee, outFee);
    }

    /// @notice getAmountIn always >= getAmountOut (for same params, within rounding)
    function testFuzz_amountInAlwaysMoreThanOut(uint256 amount) public view {
        // Constrain to avoid rounding edge cases at extreme values
        amount = bound(amount, 1e6, 1e20);
        uint256 reserve = 1e24;

        uint256 out = curve.getAmountOut(amount, reserve, reserve, 30, "");
        if (out == 0) return;
        uint256 neededIn = curve.getAmountIn(out, reserve, reserve, 30, "");

        // Allow 1 wei tolerance for integer rounding
        assertGe(neededIn + 1, amount);
    }

    /// @notice Larger input gives larger output (monotonically increasing)
    function testFuzz_monotonicallyIncreasing(uint256 amt1, uint256 amt2) public view {
        amt1 = bound(amt1, 1, 1e22);
        amt2 = bound(amt2, amt1 + 1, 1e22 + 1);

        uint256 out1 = curve.getAmountOut(amt1, 1e24, 1e24, 0, "");
        uint256 out2 = curve.getAmountOut(amt2, 1e24, 1e24, 0, "");

        assertGe(out2, out1);
    }
}
