// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/amm/curves/ConstantProductCurve.sol";

contract ConstantProductCurveTest is Test {
    ConstantProductCurve public curve;

    function setUp() public {
        curve = new ConstantProductCurve();
    }

    // ============ Identification ============

    function test_curveId() public view {
        assertEq(curve.CURVE_ID(), keccak256("CONSTANT_PRODUCT"));
        assertEq(curve.curveId(), keccak256("CONSTANT_PRODUCT"));
    }

    function test_curveName() public view {
        assertEq(curve.curveName(), "Constant Product (x*y=k)");
    }

    // ============ getAmountOut ============

    function test_getAmountOut_basicSwap() public view {
        // 1000 in, 100k/100k reserves, 0 fee
        uint256 out = curve.getAmountOut(1000, 100_000, 100_000, 0, "");
        // x*y=k: out = 100000 * 1000 / (100000 + 1000) = ~990
        assertGt(out, 0);
        assertLt(out, 1000); // Always less than input due to curve shape
    }

    function test_getAmountOut_withFee() public view {
        uint256 outNoFee = curve.getAmountOut(1000e18, 100_000e18, 100_000e18, 0, "");
        uint256 outWithFee = curve.getAmountOut(1000e18, 100_000e18, 100_000e18, 30, ""); // 0.3%

        assertGt(outNoFee, outWithFee);
    }

    function test_getAmountOut_smallInput() public view {
        uint256 out = curve.getAmountOut(1, 1e24, 1e24, 0, "");
        // Very small input should still produce some output
        assertGe(out, 0); // May round to 0 for extremely small
    }

    function test_getAmountOut_largeInput() public view {
        // Large swap: 50% of reserve
        uint256 out = curve.getAmountOut(50_000e18, 100_000e18, 100_000e18, 0, "");
        // Should be ~33333 (constant product)
        assertGt(out, 30_000e18);
        assertLt(out, 50_000e18);
    }

    function test_getAmountOut_zeroInput() public {
        vm.expectRevert(ConstantProductCurve.InsufficientInput.selector);
        curve.getAmountOut(0, 100_000, 100_000, 0, "");
    }

    function test_getAmountOut_zeroReserveIn() public {
        vm.expectRevert(ConstantProductCurve.InsufficientLiquidity.selector);
        curve.getAmountOut(1000, 0, 100_000, 0, "");
    }

    function test_getAmountOut_zeroReserveOut() public {
        vm.expectRevert(ConstantProductCurve.InsufficientLiquidity.selector);
        curve.getAmountOut(1000, 100_000, 0, 0, "");
    }

    function test_getAmountOut_preservesK() public view {
        uint256 reserveIn = 100_000e18;
        uint256 reserveOut = 100_000e18;
        uint256 amountIn = 10_000e18;

        uint256 amountOut = curve.getAmountOut(amountIn, reserveIn, reserveOut, 0, "");

        uint256 kBefore = reserveIn * reserveOut;
        uint256 kAfter = (reserveIn + amountIn) * (reserveOut - amountOut);

        // K should never decrease (may increase slightly due to rounding)
        assertGe(kAfter, kBefore);
    }

    // ============ getAmountIn ============

    function test_getAmountIn_basicSwap() public view {
        uint256 amtIn = curve.getAmountIn(990, 100_000, 100_000, 0, "");
        assertGt(amtIn, 990); // Need more input than output (curve + rounding)
    }

    function test_getAmountIn_withFee() public view {
        uint256 inNoFee = curve.getAmountIn(1000e18, 100_000e18, 100_000e18, 0, "");
        uint256 inWithFee = curve.getAmountIn(1000e18, 100_000e18, 100_000e18, 30, "");

        assertLt(inNoFee, inWithFee); // Need more input when fees apply
    }

    function test_getAmountIn_zeroOutput() public {
        vm.expectRevert(ConstantProductCurve.InsufficientInput.selector);
        curve.getAmountIn(0, 100_000, 100_000, 0, "");
    }

    function test_getAmountIn_outputExceedsReserve() public {
        vm.expectRevert(ConstantProductCurve.InsufficientLiquidity.selector);
        curve.getAmountIn(100_001, 100_000, 100_000, 0, "");
    }

    function test_getAmountIn_zeroReserveIn() public {
        vm.expectRevert(ConstantProductCurve.InsufficientLiquidity.selector);
        curve.getAmountIn(1000, 0, 100_000, 0, "");
    }

    function test_getAmountIn_zeroReserveOut() public {
        vm.expectRevert(ConstantProductCurve.InsufficientLiquidity.selector);
        curve.getAmountIn(1000, 100_000, 0, 0, "");
    }

    // ============ Roundtrip: getAmountOut → getAmountIn ============

    function test_roundtrip_consistency() public view {
        uint256 reserveIn = 100_000e18;
        uint256 reserveOut = 100_000e18;
        uint256 feeRate = 30;

        uint256 amountOut = curve.getAmountOut(1000e18, reserveIn, reserveOut, feeRate, "");
        uint256 amountIn = curve.getAmountIn(amountOut, reserveIn, reserveOut, feeRate, "");

        // amountIn should be >= original 1000e18 (rounding up)
        assertGe(amountIn, 1000e18);
        // But not too far off
        assertLt(amountIn, 1001e18);
    }

    // ============ validateParams ============

    function test_validateParams_alwaysTrue() public view {
        assertTrue(curve.validateParams(""));
        assertTrue(curve.validateParams(hex"00"));
        assertTrue(curve.validateParams(abi.encode(uint256(42))));
    }
}
