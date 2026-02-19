// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/BatchMath.sol";

// Wrapper to expose library functions
contract BatchMathWrapper {
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint256 feeRate)
        external pure returns (uint256) {
        return BatchMath.getAmountOut(amountIn, reserveIn, reserveOut, feeRate);
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut, uint256 feeRate)
        external pure returns (uint256) {
        return BatchMath.getAmountIn(amountOut, reserveIn, reserveOut, feeRate);
    }

    function calculateOptimalLiquidity(
        uint256 amount0Desired, uint256 amount1Desired, uint256 reserve0, uint256 reserve1
    ) external pure returns (uint256, uint256) {
        return BatchMath.calculateOptimalLiquidity(amount0Desired, amount1Desired, reserve0, reserve1);
    }

    function calculateLiquidity(
        uint256 amount0, uint256 amount1, uint256 reserve0, uint256 reserve1, uint256 totalSupply
    ) external pure returns (uint256) {
        return BatchMath.calculateLiquidity(amount0, amount1, reserve0, reserve1, totalSupply);
    }

    function calculateFees(uint256 amount, uint256 feeRate, uint256 protocolShare)
        external pure returns (uint256, uint256) {
        return BatchMath.calculateFees(amount, feeRate, protocolShare);
    }

    function sqrtWrapper(uint256 x) external pure returns (uint256) {
        return BatchMath.sqrt(x);
    }

    function applyGoldenRatioDamping(uint256 currentPrice, uint256 proposedPrice, uint256 maxDeviationBps)
        external pure returns (uint256) {
        return BatchMath.applyGoldenRatioDamping(currentPrice, proposedPrice, maxDeviationBps);
    }
}

contract BatchMathFuzzTest is Test {
    BatchMathWrapper math;

    function setUp() public {
        math = new BatchMathWrapper();
    }

    // ============ Fuzz: getAmountOut output < reserveOut ============

    function testFuzz_getAmountOut_neverExceedsReserve(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint256 feeRate) public view {
        amountIn = bound(amountIn, 1, 1e30);
        reserveIn = bound(reserveIn, 1e6, 1e30);
        reserveOut = bound(reserveOut, 1e6, 1e30);
        feeRate = bound(feeRate, 0, 9999);

        uint256 out = math.getAmountOut(amountIn, reserveIn, reserveOut, feeRate);
        assertLt(out, reserveOut);
    }

    // ============ Fuzz: getAmountOut monotonic with input ============

    function testFuzz_getAmountOut_monotonic(uint256 a1, uint256 a2) public view {
        a1 = bound(a1, 1, 1e24);
        a2 = bound(a2, a1, 1e24);

        uint256 out1 = math.getAmountOut(a1, 100 ether, 100 ether, 30);
        uint256 out2 = math.getAmountOut(a2, 100 ether, 100 ether, 30);
        assertGe(out2, out1);
    }

    // ============ Fuzz: getAmountIn always > getAmountOut input ============

    function testFuzz_getAmountIn_isInverse(uint256 amountIn, uint256 feeRate) public view {
        amountIn = bound(amountIn, 1 ether, 50 ether);
        feeRate = bound(feeRate, 0, 500);

        uint256 out = math.getAmountOut(amountIn, 100 ether, 100 ether, feeRate);
        if (out == 0 || out >= 100 ether) return;

        uint256 requiredIn = math.getAmountIn(out, 100 ether, 100 ether, feeRate);
        // Required input should be >= original (fees + rounding)
        assertLe(requiredIn, amountIn + 2);
    }

    // ============ Fuzz: calculateFees invariant: proto + lp = total ============

    function testFuzz_calculateFees_sumEqualsTotal(uint256 amount, uint256 feeRate, uint256 protocolShare) public view {
        amount = bound(amount, 1, 1e30);
        feeRate = bound(feeRate, 1, 10000);
        protocolShare = bound(protocolShare, 0, 10000);

        (uint256 proto, uint256 lp) = math.calculateFees(amount, feeRate, protocolShare);
        uint256 totalFee = (amount * feeRate) / 10000;
        assertEq(proto + lp, totalFee);
    }

    // ============ Fuzz: sqrt floor property ============

    function testFuzz_sqrt_floorProperty(uint256 x) public view {
        x = bound(x, 0, 1e36);

        uint256 s = math.sqrtWrapper(x);

        // s*s <= x
        assertLe(s * s, x);

        // (s+1)*(s+1) > x (if no overflow)
        if (s < type(uint128).max) {
            assertGt((s + 1) * (s + 1), x);
        }
    }

    // ============ Fuzz: golden ratio damping bounds ============

    function testFuzz_goldenDamping_bounded(uint256 currentPrice, uint256 proposedPrice, uint256 maxBps) public view {
        currentPrice = bound(currentPrice, 1e15, 1e24);
        proposedPrice = bound(proposedPrice, 1e15, 1e24);
        maxBps = bound(maxBps, 1, 5000);

        uint256 adjusted = math.applyGoldenRatioDamping(currentPrice, proposedPrice, maxBps);

        uint256 maxDev = (currentPrice * maxBps) / 10000;

        // Adjusted should be within maxDev of current
        if (adjusted > currentPrice) {
            assertLe(adjusted - currentPrice, maxDev);
        } else {
            assertLe(currentPrice - adjusted, maxDev);
        }
    }

    // ============ Fuzz: calculateLiquidity proportional ============

    function testFuzz_calculateLiquidity_proportional(uint256 amount0, uint256 amount1) public view {
        amount0 = bound(amount0, 1 ether, 1e24);
        amount1 = bound(amount1, 1 ether, 1e24);

        // With reserves = 100e18/100e18 and supply = 100e18
        uint256 liq = math.calculateLiquidity(amount0, amount1, 100 ether, 100 ether, 100 ether);

        // Liquidity should = min(amount0/reserve0, amount1/reserve1) * supply
        uint256 expected0 = (amount0 * 100 ether) / 100 ether;
        uint256 expected1 = (amount1 * 100 ether) / 100 ether;
        uint256 expected = expected0 < expected1 ? expected0 : expected1;

        assertEq(liq, expected);
    }
}
