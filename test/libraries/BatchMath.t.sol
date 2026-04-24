// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/BatchMath.sol";

/// @notice Harness contract that wraps BatchMath library calls as external functions
/// so vm.expectRevert() can intercept reverts from internal library calls.
contract BatchMathHarness {
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint256 feeRate)
        external pure returns (uint256)
    {
        return BatchMath.getAmountOut(amountIn, reserveIn, reserveOut, feeRate);
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut, uint256 feeRate)
        external pure returns (uint256)
    {
        return BatchMath.getAmountIn(amountOut, reserveIn, reserveOut, feeRate);
    }

    function calculateClearingPrice(
        uint256[] memory buyOrders,
        uint256[] memory sellOrders,
        uint256 reserve0,
        uint256 reserve1
    ) external pure returns (uint256, uint256) {
        return BatchMath.calculateClearingPrice(buyOrders, sellOrders, reserve0, reserve1);
    }

    function calculateLiquidity(uint256 a0, uint256 a1, uint256 r0, uint256 r1, uint256 ts)
        external pure returns (uint256)
    {
        return BatchMath.calculateLiquidity(a0, a1, r0, r1, ts);
    }

    function calculateOptimalLiquidity(uint256 d0, uint256 d1, uint256 r0, uint256 r1)
        external pure returns (uint256, uint256)
    {
        return BatchMath.calculateOptimalLiquidity(d0, d1, r0, r1);
    }
}

/**
 * @title BatchMathTest
 * @notice Unit tests for BatchMath library — AMM math, fees, clearing price
 */
contract BatchMathTest is Test {
    uint256 constant PRECISION = 1e18;
    BatchMathHarness harness;

    function setUp() public {
        harness = new BatchMathHarness();
    }

    // ============ sqrt ============

    function test_sqrt_zero() public pure {
        assertEq(BatchMath.sqrt(0), 0);
    }

    function test_sqrt_one() public pure {
        assertEq(BatchMath.sqrt(1), 1);
    }

    function test_sqrt_perfectSquares() public pure {
        assertEq(BatchMath.sqrt(4), 2);
        assertEq(BatchMath.sqrt(9), 3);
        assertEq(BatchMath.sqrt(100), 10);
        assertEq(BatchMath.sqrt(10000), 100);
        assertEq(BatchMath.sqrt(1e18), 1e9);
    }

    function test_sqrt_nonPerfectSquare_floorsDown() public pure {
        // sqrt(2) = 1 (floor)
        assertEq(BatchMath.sqrt(2), 1);
        // sqrt(8) = 2 (floor)
        assertEq(BatchMath.sqrt(8), 2);
        // sqrt(99) = 9
        assertEq(BatchMath.sqrt(99), 9);
    }

    function test_sqrt_large() public pure {
        // sqrt(type(uint128).max) should not overflow
        uint256 x = type(uint128).max;
        uint256 s = BatchMath.sqrt(x);
        assertGe(s * s, x - s * 2); // floor property: s^2 <= x
        assertLe(s * s, x);
        assertGt((s + 1) * (s + 1), x); // (s+1)^2 > x
    }

    function testFuzz_sqrt_floorProperty(uint128 x) public pure {
        uint256 val = uint256(x);
        uint256 s = BatchMath.sqrt(val);
        assertLe(s * s, val);
        if (s > 0) {
            // (s+1)^2 > val — use safe multiply to avoid spurious overflow
            uint256 next = s + 1;
            assertGt(next * next, val);
        }
    }

    // ============ getAmountOut ============

    function test_getAmountOut_basic() public pure {
        // 1000 in, equal reserves 1000/1000, 30 bps fee
        // amountInWithFee = 1000 * (10000 - 30) = 9970000
        // numerator = 9970000 * 1000 = 9970000000
        // denominator = 1000 * 10000 + 9970000 = 10000000 + 9970000 = 19970000
        // amountOut = 9970000000 / 19970000 = 499
        uint256 amountOut = BatchMath.getAmountOut(1000, 1000, 1000, 30);
        assertEq(amountOut, 499);
    }

    function test_getAmountOut_zeroFee() public pure {
        // With 0 fee: amountInWithFee = amountIn * 10000
        // numerator = amountIn * 10000 * reserveOut
        // denominator = reserveIn * 10000 + amountIn * 10000
        // = amountIn * reserveOut / (reserveIn + amountIn) exactly
        uint256 amountOut = BatchMath.getAmountOut(1000, 10000, 10000, 0);
        // = 1000 * 10000 / (10000 + 1000) = 10000000 / 11000 = 909
        assertEq(amountOut, 909);
    }

    function test_getAmountOut_revertsOnZeroInput() public {
        vm.expectRevert();
        harness.getAmountOut(0, 1000, 1000, 30);
    }

    function test_getAmountOut_revertsOnZeroReserves() public {
        vm.expectRevert();
        harness.getAmountOut(100, 0, 1000, 30);

        vm.expectRevert();
        harness.getAmountOut(100, 1000, 0, 30);
    }

    function test_getAmountOut_outputLessThanInput() public pure {
        // Output should always be less than reserveOut
        uint256 amountOut = BatchMath.getAmountOut(500, 1000, 1000, 30);
        assertLt(amountOut, 1000);
    }

    function testFuzz_getAmountOut_constantProductHolds(
        uint112 reserveIn,
        uint112 reserveOut,
        uint64 amountIn
    ) public pure {
        vm.assume(reserveIn > 0 && reserveOut > 0 && amountIn > 0);
        vm.assume(uint256(reserveIn) + amountIn < type(uint128).max);

        uint256 amountOut = BatchMath.getAmountOut(amountIn, reserveIn, reserveOut, 0);

        // Constant product: (reserveIn + amountIn) * (reserveOut - amountOut) >= reserveIn * reserveOut
        uint256 k1 = uint256(reserveIn) * uint256(reserveOut);
        uint256 k2 = (uint256(reserveIn) + amountIn) * (uint256(reserveOut) - amountOut);
        assertGe(k2, k1);
    }

    // ============ getAmountIn ============

    function test_getAmountIn_basic() public pure {
        // Want 499 out from 1000/1000 pool, 30 bps
        uint256 amountIn = BatchMath.getAmountIn(499, 1000, 1000, 30);
        // Should need ~1000 in (reverse of above)
        assertGt(amountIn, 0);
        // Verify: getAmountOut(amountIn) >= desiredOutput
        uint256 actualOut = BatchMath.getAmountOut(amountIn, 1000, 1000, 30);
        assertGe(actualOut, 499);
    }

    function test_getAmountIn_revertsOnZeroOutput() public {
        vm.expectRevert();
        harness.getAmountIn(0, 1000, 1000, 30);
    }

    function test_getAmountIn_revertsWhenOutputExceedsReserve() public {
        vm.expectRevert();
        harness.getAmountIn(1000, 1000, 1000, 30); // amountOut == reserveOut
    }

    function test_getAmountIn_revertsWhenOutputGreaterThanReserve() public {
        vm.expectRevert();
        harness.getAmountIn(1001, 1000, 1000, 30);
    }

    // Round-trip: getAmountIn -> getAmountOut should recover >= desired amount
    function testFuzz_getAmountIn_roundTrip(
        uint112 reserveIn,
        uint112 reserveOut,
        uint64 desiredOut
    ) public pure {
        vm.assume(reserveIn > 0 && reserveOut > 1000);
        vm.assume(desiredOut > 0 && desiredOut < reserveOut);
        vm.assume(uint256(reserveIn) < type(uint120).max);

        uint256 amountIn = BatchMath.getAmountIn(desiredOut, reserveIn, reserveOut, 30);
        uint256 actualOut = BatchMath.getAmountOut(amountIn, reserveIn, reserveOut, 30);
        assertGe(actualOut, desiredOut);
    }

    // ============ calculateFees ============

    function test_calculateFees_basic() public pure {
        // 1 million tokens, 30 bps fee, 20% protocol share (2000 bps)
        (uint256 protocolFee, uint256 lpFee) = BatchMath.calculateFees(1_000_000, 30, 2000);
        // totalFee = 1_000_000 * 30 / 10000 = 3000
        // protocolFee = 1_000_000 * 30 * 2000 / (10000*10000) = 60_000_000 / 100_000_000 = 0
        // The actual formula: protocolFee = amount * feeRate * protocolShare / (10000 * 10000)
        // = 1_000_000 * 30 * 2000 / 100_000_000 = 60_000_000 / 100_000_000 = 0 (rounds down)
        // Let's use larger number to avoid dust
        (uint256 pFee, uint256 lFee) = BatchMath.calculateFees(1_000_000_000, 30, 2000);
        uint256 totalFee = (1_000_000_000 * 30) / 10000; // = 3_000_000
        assertEq(pFee + lFee, totalFee);
        assertGt(lFee, pFee); // LP gets majority
    }

    function test_calculateFees_zeroProtocolShare() public pure {
        (uint256 protocolFee, uint256 lpFee) = BatchMath.calculateFees(1_000_000, 30, 0);
        assertEq(protocolFee, 0);
        assertEq(lpFee, (1_000_000 * 30) / 10000);
    }

    function test_calculateFees_fullProtocolShare() public pure {
        // 100% to protocol (10000 bps)
        (uint256 protocolFee, uint256 lpFee) = BatchMath.calculateFees(1_000_000_000, 30, 10000);
        uint256 totalFee = (1_000_000_000 * 30) / 10000;
        assertEq(protocolFee, totalFee);
        assertEq(lpFee, 0);
    }

    function test_calculateFees_zeroFeeRate() public pure {
        (uint256 protocolFee, uint256 lpFee) = BatchMath.calculateFees(1_000_000, 0, 2000);
        assertEq(protocolFee, 0);
        assertEq(lpFee, 0);
    }

    // ============ calculateOptimalLiquidity ============

    function test_calculateOptimalLiquidity_emptyPool() public pure {
        // Fresh pool — both desired amounts are accepted as-is
        (uint256 a0, uint256 a1) = BatchMath.calculateOptimalLiquidity(500, 1000, 0, 0);
        assertEq(a0, 500);
        assertEq(a1, 1000);
    }

    function test_calculateOptimalLiquidity_exactRatio() public pure {
        // Pool is 1:2, deposit 100:200 (exact ratio)
        (uint256 a0, uint256 a1) = BatchMath.calculateOptimalLiquidity(100, 200, 500, 1000);
        assertEq(a0, 100);
        assertEq(a1, 200);
    }

    function test_calculateOptimalLiquidity_excess1() public pure {
        // Pool 1:2, want to deposit 100:300 (too much token1)
        // Optimal: amount1 = 100 * 1000 / 500 = 200 (< 300), so use 100:200
        (uint256 a0, uint256 a1) = BatchMath.calculateOptimalLiquidity(100, 300, 500, 1000);
        assertEq(a0, 100);
        assertEq(a1, 200);
    }

    function test_calculateOptimalLiquidity_excess0() public pure {
        // Pool 1:2, want to deposit 300:200 (too much token0)
        // amount1Optimal = 300 * 1000 / 500 = 600 > 200, so fallback:
        // amount0Optimal = 200 * 500 / 1000 = 100 <= 300, so use 100:200
        (uint256 a0, uint256 a1) = BatchMath.calculateOptimalLiquidity(300, 200, 500, 1000);
        assertEq(a0, 100);
        assertEq(a1, 200);
    }

    function testFuzz_calculateOptimalLiquidity_maintainsRatio(
        uint96 reserve0,
        uint96 reserve1,
        uint96 desired0,
        uint96 desired1
    ) public pure {
        vm.assume(reserve0 > 0 && reserve1 > 0);
        vm.assume(desired0 > 0 && desired1 > 0);
        // Avoid overflow in library
        vm.assume(uint256(desired0) * reserve1 < type(uint128).max);
        vm.assume(uint256(desired1) * reserve0 < type(uint128).max);

        (uint256 a0, uint256 a1) = BatchMath.calculateOptimalLiquidity(
            desired0, desired1, reserve0, reserve1
        );

        // Result should not exceed desired amounts
        assertLe(a0, desired0);
        assertLe(a1, desired1);

        // Ratio check: a0 / a1 should approximately equal reserve0 / reserve1
        // i.e., a0 * reserve1 == a1 * reserve0 (within integer division rounding)
        if (a0 > 0 && a1 > 0) {
            uint256 lhs = a0 * uint256(reserve1);
            uint256 rhs = a1 * uint256(reserve0);
            // The rounding error from integer division can be up to max(reserve0, reserve1)
            uint256 tolerance = uint256(reserve0) > uint256(reserve1) ? uint256(reserve0) : uint256(reserve1);
            assertLe(lhs, rhs + tolerance);
            assertLe(rhs, lhs + tolerance);
        }
    }

    // ============ calculateLiquidity ============

    function test_calculateLiquidity_initial() public pure {
        // sqrt(100 * 100) = 100, minus 1000 minimum locked => reverts (too small)
        // Use larger amounts
        // sqrt(1e12 * 1e12) = 1e12, -1000 = 999999999999000
        uint256 lp = BatchMath.calculateLiquidity(1e12, 1e12, 0, 0, 0);
        assertEq(lp, 1e12 - 1000);
    }

    function test_calculateLiquidity_initial_revertsIfTooSmall() public {
        // sqrt(100*100)=100 <= 1000 => revert
        vm.expectRevert();
        harness.calculateLiquidity(100, 100, 0, 0, 0);
    }

    function test_calculateLiquidity_proportional() public pure {
        // Pool: 1000/1000 with totalSupply 500
        // Deposit 100/100 => min(100*500/1000, 100*500/1000) = 50
        uint256 lp = BatchMath.calculateLiquidity(100, 100, 1000, 1000, 500);
        assertEq(lp, 50);
    }

    function test_calculateLiquidity_takeMinSide() public pure {
        // Pool: 1000/2000 with totalSupply 1000
        // Deposit 100/100 (imbalanced — token1 side is less generous)
        // liquidity0 = 100 * 1000 / 1000 = 100
        // liquidity1 = 100 * 1000 / 2000 = 50
        // min(100, 50) = 50
        uint256 lp = BatchMath.calculateLiquidity(100, 100, 1000, 2000, 1000);
        assertEq(lp, 50);
    }

    // ============ calculateClearingPrice ============

    function test_calculateClearingPrice_noOrders_returnsSpot() public pure {
        uint256[] memory buyOrders = new uint256[](0);
        uint256[] memory sellOrders = new uint256[](0);
        (uint256 price, uint256 volume) = BatchMath.calculateClearingPrice(
            buyOrders, sellOrders, 1000, 2000
        );
        // spotPrice = 2000 * 1e18 / 1000 = 2e18
        assertEq(price, 2e18);
        assertEq(volume, 0);
    }

    function test_calculateClearingPrice_revertsOnZeroReserves() public {
        uint256[] memory buyOrders = new uint256[](0);
        uint256[] memory sellOrders = new uint256[](0);
        vm.expectRevert();
        harness.calculateClearingPrice(buyOrders, sellOrders, 0, 1000);
    }

    function test_calculateClearingPrice_withOrders() public pure {
        // Buy order: 100 tokens at max price 2.5e18
        // Sell order: 100 tokens at min price 1.5e18
        uint256[] memory buyOrders = new uint256[](2);
        buyOrders[0] = 100;
        buyOrders[1] = 25e17; // 2.5e18

        uint256[] memory sellOrders = new uint256[](2);
        sellOrders[0] = 100;
        sellOrders[1] = 15e17; // 1.5e18

        (uint256 price,) = BatchMath.calculateClearingPrice(
            buyOrders, sellOrders, 1000, 2000
        );
        // Clearing price should be between the spot (2e18) and order limits
        assertGt(price, 0);
    }

    // ============ applyDeviationCap ============

    function test_goldenRatioDamping_noChange_withinBounds() public pure {
        // Proposed price within maxDeviation → no damping
        uint256 result = BatchMath.applyDeviationCap(1000e18, 1050e18, 1000); // 10% max
        assertEq(result, 1050e18);
    }

    function test_goldenRatioDamping_capsIncrease() public pure {
        // Proposed is 50% above, max is 10% — should be capped
        uint256 current = 1000e18;
        uint256 proposed = 1500e18; // 50% increase
        uint256 maxBps = 1000; // 10%
        uint256 result = BatchMath.applyDeviationCap(current, proposed, maxBps);
        // maxDeviation = 100e18, dampedIncrease = 100e18 * PHI / 1e18
        // PHI = 1.618e18 => dampedIncrease = ~161.8e18, capped at 100e18
        assertEq(result, current + 100e18);
    }

    function test_goldenRatioDamping_capsDecrease() public pure {
        uint256 current = 1000e18;
        uint256 proposed = 500e18; // 50% decrease
        uint256 maxBps = 1000; // 10%
        uint256 result = BatchMath.applyDeviationCap(current, proposed, maxBps);
        assertEq(result, current - 100e18);
    }

    function test_goldenRatioDamping_equalPrices() public pure {
        uint256 result = BatchMath.applyDeviationCap(1000e18, 1000e18, 500);
        assertEq(result, 1000e18);
    }

}
