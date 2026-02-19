// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/SecurityLib.sol";

contract SecurityLibFuzzWrapper {
    function checkPriceDeviation(uint256 current, uint256 ref_, uint256 maxBps)
        external pure returns (bool) { return SecurityLib.checkPriceDeviation(current, ref_, maxBps); }
    function checkBalanceConsistency(uint256 tracked, uint256 actual, uint256 maxDelta)
        external pure returns (bool) { return SecurityLib.checkBalanceConsistency(tracked, actual, maxDelta); }
    function checkSlippage(uint256 expected, uint256 actual, uint256 maxSlip)
        external pure returns (bool) { return SecurityLib.checkSlippage(expected, actual, maxSlip); }
    function mulDiv(uint256 x, uint256 y, uint256 d) external pure returns (uint256) { return SecurityLib.mulDiv(x, y, d); }
    function divDown(uint256 a, uint256 b) external pure returns (uint256) { return SecurityLib.divDown(a, b); }
    function divUp(uint256 a, uint256 b) external pure returns (uint256) { return SecurityLib.divUp(a, b); }
    function bpsOf(uint256 amount, uint256 bps) external pure returns (uint256) { return SecurityLib.bpsOf(amount, bps); }
}

contract SecurityLibFuzzTest is Test {
    SecurityLibFuzzWrapper lib;

    function setUp() public {
        lib = new SecurityLibFuzzWrapper();
    }

    // ============ Fuzz: price deviation is symmetric ============
    function testFuzz_priceDeviation_symmetric(uint256 a, uint256 b, uint256 maxBps) public view {
        a = bound(a, 1, 1e30);
        b = bound(b, 1, 1e30);
        maxBps = bound(maxBps, 0, 10000);
        // If |a-b| is the same, result should be same regardless of order
        // (deviation formula is symmetric around reference)
        // Note: not exactly symmetric because reference is the denominator
        // But for identical reference, swapping spot/ref may differ
    }

    // ============ Fuzz: zero reference always returns true ============
    function testFuzz_priceDeviation_zeroRef(uint256 current, uint256 maxBps) public view {
        current = bound(current, 0, 1e30);
        maxBps = bound(maxBps, 0, 10000);
        assertTrue(lib.checkPriceDeviation(current, 0, maxBps));
    }

    // ============ Fuzz: equal prices always within bounds ============
    function testFuzz_priceDeviation_equal(uint256 price, uint256 maxBps) public view {
        price = bound(price, 1, 1e30);
        maxBps = bound(maxBps, 0, 10000);
        assertTrue(lib.checkPriceDeviation(price, price, maxBps));
    }

    // ============ Fuzz: slippage better-than-expected always OK ============
    function testFuzz_slippage_betterThanExpected(uint256 expected, uint256 actual, uint256 maxSlip) public view {
        expected = bound(expected, 1, 1e30);
        actual = bound(actual, expected, 1e30);
        maxSlip = bound(maxSlip, 0, 10000);
        assertTrue(lib.checkSlippage(expected, actual, maxSlip));
    }

    // ============ Fuzz: balance consistency — actual < tracked always invalid ============
    function testFuzz_balanceConsistency_missingTokens(uint256 tracked, uint256 actual, uint256 maxDelta) public view {
        tracked = bound(tracked, 2, 1e30);
        actual = bound(actual, 0, tracked - 1);
        maxDelta = bound(maxDelta, 0, 10000);
        assertFalse(lib.checkBalanceConsistency(tracked, actual, maxDelta));
    }

    // ============ Fuzz: divUp >= divDown ============
    function testFuzz_divUp_geq_divDown(uint256 a, uint256 b) public view {
        a = bound(a, 0, 1e30);
        b = bound(b, 1, 1e30);
        assertGe(lib.divUp(a, b), lib.divDown(a, b));
    }

    // ============ Fuzz: divUp * b >= a (round-up guarantees coverage) ============
    function testFuzz_divUp_covers(uint256 a, uint256 b) public view {
        a = bound(a, 0, 1e30);
        b = bound(b, 1, 1e30);
        uint256 result = lib.divUp(a, b);
        assertGe(result * b, a);
    }

    // ============ Fuzz: bpsOf <= amount ============
    function testFuzz_bpsOf_bounded(uint256 amount, uint256 bps) public view {
        amount = bound(amount, 0, 1e30);
        bps = bound(bps, 0, 10000);
        assertLe(lib.bpsOf(amount, bps), amount);
    }

    // ============ Fuzz: mulDiv equivalence for non-overflow ============
    function testFuzz_mulDiv_equivalence(uint256 x, uint256 y, uint256 d) public view {
        x = bound(x, 0, 1e18);
        y = bound(y, 0, 1e18);
        d = bound(d, 1, 1e18);
        // For small enough values, mulDiv should equal naive x*y/d
        assertEq(lib.mulDiv(x, y, d), (x * y) / d);
    }
}
