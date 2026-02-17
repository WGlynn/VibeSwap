// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/amm/curves/StableSwapCurve.sol";

contract StableSwapCurveFuzzTest is Test {
    StableSwapCurve public curve;

    function setUp() public {
        curve = new StableSwapCurve();
    }

    /// @notice Output is always less than reserveOut
    function testFuzz_outputBounded(uint256 amountIn, uint256 A) public view {
        amountIn = bound(amountIn, 1e12, 1e22);
        A = bound(A, 1, 10000);

        uint256 out = curve.getAmountOut(amountIn, 1e24, 1e24, 0, abi.encode(A));
        assertLt(out, 1e24);
        assertGt(out, 0);
    }

    /// @notice Higher A gives less slippage on balanced pool
    function testFuzz_higherALessSlippage(uint256 A1, uint256 A2) public view {
        A1 = bound(A1, 1, 4999);
        A2 = bound(A2, A1 + 1, 5000);

        uint256 amountIn = 10_000e18;
        uint256 reserve = 100_000e18;

        uint256 out1 = curve.getAmountOut(amountIn, reserve, reserve, 0, abi.encode(A1));
        uint256 out2 = curve.getAmountOut(amountIn, reserve, reserve, 0, abi.encode(A2));

        assertGe(out2, out1); // Higher A = less slippage = more output
    }

    /// @notice Fees always reduce output
    function testFuzz_feesReduceOutput(uint256 feeRate) public view {
        feeRate = bound(feeRate, 1, 500);

        uint256 outNoFee = curve.getAmountOut(1000e18, 100_000e18, 100_000e18, 0, abi.encode(uint256(100)));
        uint256 outFee = curve.getAmountOut(1000e18, 100_000e18, 100_000e18, feeRate, abi.encode(uint256(100)));

        assertGt(outNoFee, outFee);
    }

    /// @notice validateParams correctly validates A range
    function testFuzz_validateParams(uint256 A) public view {
        A = bound(A, 0, 20000);
        bool valid = curve.validateParams(abi.encode(A));

        if (A >= 1 && A <= 10000) {
            assertTrue(valid);
        } else {
            assertFalse(valid);
        }
    }

    /// @notice Roundtrip consistency: getAmountOut → getAmountIn ≈ original
    function testFuzz_roundtripConsistency(uint256 amountIn) public view {
        amountIn = bound(amountIn, 1e12, 1e22);
        uint256 reserve = 1e24;
        bytes memory params = abi.encode(uint256(100));

        uint256 out = curve.getAmountOut(amountIn, reserve, reserve, 0, params);
        if (out == 0) return;

        uint256 neededIn = curve.getAmountIn(out, reserve, reserve, 0, params);
        // Due to rounding, neededIn >= amountIn
        assertGe(neededIn, amountIn);
        // But within reasonable bounds (0.1% tolerance)
        assertLe(neededIn, amountIn + amountIn / 1000 + 2);
    }
}
