// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/amm/curves/StableSwapCurve.sol";

contract StableSwapCurveTest is Test {
    StableSwapCurve public curve;

    // Convenience: A=100 encoded
    bytes public paramsA100 = abi.encode(uint256(100));
    bytes public paramsA1 = abi.encode(uint256(1));
    bytes public paramsA1000 = abi.encode(uint256(1000));

    function setUp() public {
        curve = new StableSwapCurve();
    }

    // ============ Identification ============

    function test_curveId() public view {
        assertEq(curve.CURVE_ID(), keccak256("STABLE_SWAP"));
        assertEq(curve.curveId(), keccak256("STABLE_SWAP"));
    }

    function test_curveName() public view {
        assertEq(curve.curveName(), "StableSwap (Curve.fi invariant)");
    }

    // ============ Constants ============

    function test_constants() public view {
        assertEq(curve.MIN_A(), 1);
        assertEq(curve.MAX_A(), 10000);
    }

    // ============ getAmountOut ============

    function test_getAmountOut_equalReserves() public view {
        // Balanced pool: 100k/100k with A=100, swap 1000
        uint256 out = curve.getAmountOut(1000e18, 100_000e18, 100_000e18, 0, paramsA100);
        // StableSwap with high A should give close to 1:1
        assertGt(out, 990e18); // Close to 1:1
        assertLe(out, 1000e18);
    }

    function test_getAmountOut_highA_nearParity() public view {
        // A=1000, very tight peg → even closer to 1:1
        uint256 out = curve.getAmountOut(1000e18, 100_000e18, 100_000e18, 0, paramsA1000);
        assertGt(out, 999e18);
        assertLe(out, 1000e18);
    }

    function test_getAmountOut_lowA_moreSlippage() public view {
        // A=1, behaves more like constant product → more slippage
        uint256 outLowA = curve.getAmountOut(10_000e18, 100_000e18, 100_000e18, 0, paramsA1);
        uint256 outHighA = curve.getAmountOut(10_000e18, 100_000e18, 100_000e18, 0, paramsA100);

        assertLt(outLowA, outHighA); // Low A = more slippage
    }

    function test_getAmountOut_withFee() public view {
        uint256 outNoFee = curve.getAmountOut(1000e18, 100_000e18, 100_000e18, 0, paramsA100);
        uint256 outWithFee = curve.getAmountOut(1000e18, 100_000e18, 100_000e18, 30, paramsA100);

        assertGt(outNoFee, outWithFee);
    }

    function test_getAmountOut_zeroInput() public {
        vm.expectRevert(StableSwapCurve.InsufficientInput.selector);
        curve.getAmountOut(0, 100_000e18, 100_000e18, 0, paramsA100);
    }

    function test_getAmountOut_zeroReserveIn() public {
        vm.expectRevert(StableSwapCurve.InsufficientLiquidity.selector);
        curve.getAmountOut(1000e18, 0, 100_000e18, 0, paramsA100);
    }

    function test_getAmountOut_zeroReserveOut() public {
        vm.expectRevert(StableSwapCurve.InsufficientLiquidity.selector);
        curve.getAmountOut(1000e18, 100_000e18, 0, 0, paramsA100);
    }

    function test_getAmountOut_invalidA_zero() public {
        vm.expectRevert(StableSwapCurve.InvalidAmplification.selector);
        curve.getAmountOut(1000e18, 100_000e18, 100_000e18, 0, abi.encode(uint256(0)));
    }

    function test_getAmountOut_invalidA_tooHigh() public {
        vm.expectRevert(StableSwapCurve.InvalidAmplification.selector);
        curve.getAmountOut(1000e18, 100_000e18, 100_000e18, 0, abi.encode(uint256(10001)));
    }

    // ============ getAmountIn ============

    function test_getAmountIn_equalReserves() public view {
        uint256 amtIn = curve.getAmountIn(1000e18, 100_000e18, 100_000e18, 0, paramsA100);
        // StableSwap: near 1:1, so amountIn should be close to amountOut
        assertGt(amtIn, 1000e18); // +1 rounding
        assertLt(amtIn, 1010e18);
    }

    function test_getAmountIn_withFee() public view {
        uint256 inNoFee = curve.getAmountIn(1000e18, 100_000e18, 100_000e18, 0, paramsA100);
        uint256 inWithFee = curve.getAmountIn(1000e18, 100_000e18, 100_000e18, 30, paramsA100);

        assertLt(inNoFee, inWithFee);
    }

    function test_getAmountIn_zeroOutput() public {
        vm.expectRevert(StableSwapCurve.InsufficientInput.selector);
        curve.getAmountIn(0, 100_000e18, 100_000e18, 0, paramsA100);
    }

    function test_getAmountIn_outputExceedsReserve() public {
        vm.expectRevert(StableSwapCurve.InsufficientLiquidity.selector);
        curve.getAmountIn(100_001e18, 100_000e18, 100_000e18, 0, paramsA100);
    }

    function test_getAmountIn_zeroReserveIn() public {
        vm.expectRevert(StableSwapCurve.InsufficientLiquidity.selector);
        curve.getAmountIn(1000e18, 0, 100_000e18, 0, paramsA100);
    }

    function test_getAmountIn_zeroReserveOut() public {
        vm.expectRevert(StableSwapCurve.InsufficientLiquidity.selector);
        curve.getAmountIn(1000e18, 100_000e18, 0, 0, paramsA100);
    }

    // ============ Roundtrip ============

    function test_roundtrip_consistency() public view {
        uint256 reserveIn = 100_000e18;
        uint256 reserveOut = 100_000e18;

        uint256 amountOut = curve.getAmountOut(1000e18, reserveIn, reserveOut, 0, paramsA100);
        uint256 amountIn = curve.getAmountIn(amountOut, reserveIn, reserveOut, 0, paramsA100);

        // Should be close to original 1000e18 (within 2 wei for rounding)
        assertGe(amountIn, 1000e18);
        assertLe(amountIn, 1000e18 + 2);
    }

    // ============ validateParams ============

    function test_validateParams_valid() public view {
        assertTrue(curve.validateParams(abi.encode(uint256(1))));
        assertTrue(curve.validateParams(abi.encode(uint256(100))));
        assertTrue(curve.validateParams(abi.encode(uint256(10000))));
    }

    function test_validateParams_invalidZero() public view {
        assertFalse(curve.validateParams(abi.encode(uint256(0))));
    }

    function test_validateParams_invalidTooHigh() public view {
        assertFalse(curve.validateParams(abi.encode(uint256(10001))));
    }

    function test_validateParams_wrongLength() public view {
        assertFalse(curve.validateParams(""));
        assertFalse(curve.validateParams(hex"00"));
    }

    // ============ Edge Cases ============

    function test_imbalancedReserves() public view {
        // Imbalanced pool: 90k/110k
        uint256 out = curve.getAmountOut(1000e18, 90_000e18, 110_000e18, 0, paramsA100);
        assertGt(out, 0);
        assertLt(out, 1100e18); // Bounded
    }

    function test_maxAmplification() public view {
        // A=10000 max
        uint256 out = curve.getAmountOut(1000e18, 100_000e18, 100_000e18, 0, abi.encode(uint256(10000)));
        // At max A, should be extremely close to 1:1
        assertGt(out, 999e18);
    }

    function test_symmetry() public view {
        // Swapping X→Y and Y→X on balanced pool should give same output
        uint256 out1 = curve.getAmountOut(1000e18, 100_000e18, 100_000e18, 0, paramsA100);
        uint256 out2 = curve.getAmountOut(1000e18, 100_000e18, 100_000e18, 0, paramsA100);
        assertEq(out1, out2);
    }
}
