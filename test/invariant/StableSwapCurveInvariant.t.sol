// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/amm/curves/StableSwapCurve.sol";

// ============ Handler ============

contract SSCurveHandler is Test {
    StableSwapCurve public curve;

    uint256 public ghost_swapCount;
    uint256 public ghost_convergenceFailures; // Should always be 0

    constructor(StableSwapCurve _curve) {
        curve = _curve;
    }

    function doSwap(uint256 amountIn, uint256 reserve, uint256 A) public {
        amountIn = bound(amountIn, 1e12, 1e22);
        reserve = bound(reserve, 1e18, 1e28);
        A = bound(A, 1, 10000);

        try curve.getAmountOut(amountIn, reserve, reserve, 0, abi.encode(A)) returns (uint256 out) {
            ghost_swapCount++;
            if (out == 0) ghost_convergenceFailures++;
        } catch {
            // ConvergenceFailed or InsufficientLiquidity are acceptable reverts
        }
    }
}

// ============ Invariant Tests ============

contract StableSwapCurveInvariantTest is StdInvariant, Test {
    StableSwapCurve public curve;
    SSCurveHandler public handler;

    function setUp() public {
        curve = new StableSwapCurve();
        handler = new SSCurveHandler(curve);
        targetContract(address(handler));
    }

    /// @notice Swaps that succeed always produce output > 0
    function invariant_noZeroOutputSwaps() public view {
        assertEq(handler.ghost_convergenceFailures(), 0, "CONVERGENCE: zero output");
    }

    /// @notice Curve constants are immutable
    function invariant_constantsImmutable() public view {
        assertEq(curve.MIN_A(), 1, "MIN_A: changed");
        assertEq(curve.MAX_A(), 10000, "MAX_A: changed");
    }
}
