// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/FibonacciScaling.sol";

// Dummy handler so Foundry invariant framework has something to call
contract FibonacciHandler {
    uint8 public lastN;
    function setN(uint8 n) external { lastN = n; }
}

contract FibonacciScalingInvariantTest is Test {
    FibonacciHandler handler;

    function setUp() public {
        handler = new FibonacciHandler();
        targetContract(address(handler));
    }

    // ============ Invariant: fibonacci(0) = 0, fibonacci(1) = 1 always ============
    function invariant_fibonacci_baseCase() public pure {
        assertEq(FibonacciScaling.fibonacci(0), 0, "fib(0) = 0");
        assertEq(FibonacciScaling.fibonacci(1), 1, "fib(1) = 1");
        assertEq(FibonacciScaling.fibonacci(2), 1, "fib(2) = 1");
    }

    // ============ Invariant: fibonacci recurrence holds ============
    function invariant_fibonacci_recurrence() public pure {
        for (uint8 n = 2; n <= 20; n++) {
            assertEq(
                FibonacciScaling.fibonacci(n),
                FibonacciScaling.fibonacci(n - 1) + FibonacciScaling.fibonacci(n - 2),
                "Fibonacci recurrence should hold"
            );
        }
    }

    // ============ Invariant: goldenRatioMean(x, x) = x ============
    function invariant_goldenMean_identity() public pure {
        uint256 val = 1e18;
        uint256 result = FibonacciScaling.goldenRatioMean(val, val);
        assertEq(result, val, "goldenRatioMean(x, x) = x");
    }

    // ============ Invariant: retracement level0 = high ============
    function invariant_retracement_endpoints() public pure {
        FibonacciScaling.FibRetracementLevels memory levels =
            FibonacciScaling.calculateRetracementLevels(1000, 500);
        assertEq(levels.level0, 1000, "level0 should equal high");
        assertLe(levels.level786, 1000, "level786 should be <= high");
        assertGe(levels.level786, 500, "level786 should be >= low");
    }
}
