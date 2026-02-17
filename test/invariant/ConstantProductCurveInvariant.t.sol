// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/amm/curves/ConstantProductCurve.sol";

// ============ Handler ============

contract CPCurveHandler is Test {
    ConstantProductCurve public curve;

    uint256 public ghost_swapCount;
    uint256 public ghost_kViolations; // Should always be 0

    constructor(ConstantProductCurve _curve) {
        curve = _curve;
    }

    function doSwap(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) public {
        amountIn = bound(amountIn, 1, 1e22);
        reserveIn = bound(reserveIn, 1e10, 1e28);
        reserveOut = bound(reserveOut, 1e10, 1e28);

        try curve.getAmountOut(amountIn, reserveIn, reserveOut, 0, "") returns (uint256 out) {
            ghost_swapCount++;
            if (out > 0) {
                uint256 kBefore = reserveIn * reserveOut;
                uint256 kAfter = (reserveIn + amountIn) * (reserveOut - out);
                if (kAfter < kBefore) ghost_kViolations++;
            }
        } catch {}
    }
}

// ============ Invariant Tests ============

contract ConstantProductCurveInvariantTest is StdInvariant, Test {
    ConstantProductCurve public curve;
    CPCurveHandler public handler;

    function setUp() public {
        curve = new ConstantProductCurve();
        handler = new CPCurveHandler(curve);
        targetContract(address(handler));
    }

    /// @notice K invariant is never violated
    function invariant_kNeverDecreases() public view {
        assertEq(handler.ghost_kViolations(), 0, "K: violated");
    }

    /// @notice validateParams always returns true
    function invariant_alwaysValid() public view {
        assertTrue(curve.validateParams(""), "VALIDATE: failed");
    }
}
