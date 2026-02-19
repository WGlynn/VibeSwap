// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/BatchMath.sol";

// Wrapper to expose library functions for testing
contract BatchMathWrapper {
    function calculateClearingPrice(
        uint256[] memory buyOrders,
        uint256[] memory sellOrders,
        uint256 reserve0,
        uint256 reserve1
    ) external pure returns (uint256, uint256) {
        return BatchMath.calculateClearingPrice(buyOrders, sellOrders, reserve0, reserve1);
    }

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

    function calculateAMMCapacity(uint256 reserve0, uint256 reserve1, uint256 targetPrice)
        external pure returns (uint256) {
        return BatchMath.calculateAMMCapacity(reserve0, reserve1, targetPrice);
    }

    function calculateNetDemand(
        uint256[] memory buyOrders, uint256[] memory sellOrders,
        uint256 price, uint256 reserve0, uint256 reserve1
    ) external pure returns (int256, uint256) {
        return BatchMath.calculateNetDemand(buyOrders, sellOrders, price, reserve0, reserve1);
    }
}

contract BatchMathTest is Test {
    BatchMathWrapper math;

    function setUp() public {
        math = new BatchMathWrapper();
    }

    // ============ getAmountOut ============

    function test_getAmountOut_basic() public view {
        // 1 ETH in, reserves 100/100, 0.3% fee
        uint256 out = math.getAmountOut(1 ether, 100 ether, 100 ether, 30);
        // xy=k: out ≈ 0.997 * 100 / (100 + 0.997) ≈ 0.9871
        assertGt(out, 0.98 ether);
        assertLt(out, 1 ether);
    }

    function test_getAmountOut_noFee() public view {
        uint256 out = math.getAmountOut(1 ether, 100 ether, 100 ether, 0);
        // xy=k: 100*100/(100+1) = 9900.99, so out = 100 - 99.0099 ≈ 0.9901
        assertApproxEqRel(out, 0.990099009900990099 ether, 1e14);
    }

    function test_getAmountOut_revertsZeroInput() public {
        vm.expectRevert(BatchMath.InsufficientInput.selector);
        math.getAmountOut(0, 100 ether, 100 ether, 30);
    }

    function test_getAmountOut_revertsZeroReserveIn() public {
        vm.expectRevert(BatchMath.InsufficientLiquidity.selector);
        math.getAmountOut(1 ether, 0, 100 ether, 30);
    }

    function test_getAmountOut_revertsZeroReserveOut() public {
        vm.expectRevert(BatchMath.InsufficientLiquidity.selector);
        math.getAmountOut(1 ether, 100 ether, 0, 30);
    }

    function test_getAmountOut_largeInput() public view {
        // Trade 50% of reserve
        uint256 out = math.getAmountOut(50 ether, 100 ether, 100 ether, 30);
        // Should be significantly less than 50 (price impact)
        assertGt(out, 30 ether);
        assertLt(out, 50 ether);
    }

    // ============ getAmountIn ============

    function test_getAmountIn_basic() public view {
        uint256 inp = math.getAmountIn(1 ether, 100 ether, 100 ether, 30);
        // Need slightly more than 1 ETH input to get 1 ETH out
        assertGt(inp, 1 ether);
    }

    function test_getAmountIn_roundTrip() public view {
        uint256 amountIn = 5 ether;
        uint256 fee = 30;
        uint256 out = math.getAmountOut(amountIn, 100 ether, 100 ether, fee);
        uint256 requiredIn = math.getAmountIn(out, 100 ether, 100 ether, fee);
        // Required in should be ≤ original + rounding
        assertApproxEqAbs(requiredIn, amountIn, 2);
    }

    function test_getAmountIn_revertsZeroOutput() public {
        vm.expectRevert(BatchMath.InsufficientInput.selector);
        math.getAmountIn(0, 100 ether, 100 ether, 30);
    }

    function test_getAmountIn_revertsOutputExceedsReserve() public {
        vm.expectRevert(BatchMath.InsufficientLiquidity.selector);
        math.getAmountIn(100 ether, 100 ether, 100 ether, 30);
    }

    // ============ calculateOptimalLiquidity ============

    function test_calculateOptimalLiquidity_firstDeposit() public view {
        (uint256 a0, uint256 a1) = math.calculateOptimalLiquidity(100 ether, 200 ether, 0, 0);
        assertEq(a0, 100 ether);
        assertEq(a1, 200 ether);
    }

    function test_calculateOptimalLiquidity_matchesRatio() public view {
        // Reserves are 100:200, provide 50:100
        (uint256 a0, uint256 a1) = math.calculateOptimalLiquidity(50 ether, 100 ether, 100 ether, 200 ether);
        assertEq(a0, 50 ether);
        assertEq(a1, 100 ether);
    }

    function test_calculateOptimalLiquidity_adjustsDown0() public view {
        // Reserves are 100:200, provide 50:200 (too much token1)
        (uint256 a0, uint256 a1) = math.calculateOptimalLiquidity(50 ether, 200 ether, 100 ether, 200 ether);
        assertEq(a0, 50 ether);
        assertEq(a1, 100 ether);
    }

    function test_calculateOptimalLiquidity_adjustsDown1() public view {
        // Reserves are 100:200, provide 200:200 (too much token0)
        (uint256 a0, uint256 a1) = math.calculateOptimalLiquidity(200 ether, 200 ether, 100 ether, 200 ether);
        // Should adjust: a0 = 200 * 100/200 = 100, a1 = 200
        assertEq(a0, 100 ether);
        assertEq(a1, 200 ether);
    }

    // ============ calculateLiquidity ============

    function test_calculateLiquidity_initial() public view {
        uint256 liq = math.calculateLiquidity(100 ether, 100 ether, 0, 0, 0);
        // sqrt(100e18 * 100e18) - 1000 = 100e18 - 1000
        assertEq(liq, 100 ether - 1000);
    }

    function test_calculateLiquidity_proportional() public view {
        uint256 liq = math.calculateLiquidity(10 ether, 10 ether, 100 ether, 100 ether, 100 ether);
        // 10/100 * 100 = 10
        assertEq(liq, 10 ether);
    }

    function test_calculateLiquidity_usesMinRatio() public view {
        // Slightly unbalanced — takes min of two ratios
        uint256 liq = math.calculateLiquidity(10 ether, 20 ether, 100 ether, 100 ether, 100 ether);
        // min(10/100, 20/100) * 100 = 10
        assertEq(liq, 10 ether);
    }

    function test_calculateLiquidity_revertsInsufficientInitial() public {
        vm.expectRevert(BatchMath.InsufficientInitialLiquidity.selector);
        math.calculateLiquidity(100, 100, 0, 0, 0); // sqrt(10000) = 100 ≤ 1000
    }

    // ============ calculateFees ============

    function test_calculateFees_basic() public view {
        // 100 ETH, 30 bps fee, 25% protocol share
        (uint256 proto, uint256 lp) = math.calculateFees(100 ether, 30, 2500);
        uint256 totalFee = (100 ether * 30) / 10000; // 0.3 ether
        assertEq(proto + lp, totalFee);
        assertEq(proto, (totalFee * 2500) / 10000);
    }

    function test_calculateFees_zeroProtocol() public view {
        (uint256 proto, uint256 lp) = math.calculateFees(100 ether, 30, 0);
        assertEq(proto, 0);
        assertEq(lp, (100 ether * 30) / 10000);
    }

    function test_calculateFees_fullProtocol() public view {
        (uint256 proto, uint256 lp) = math.calculateFees(100 ether, 30, 10000);
        uint256 totalFee = (100 ether * 30) / 10000;
        assertEq(proto, totalFee);
        assertEq(lp, 0);
    }

    // ============ sqrt ============

    function test_sqrt_zero() public view {
        assertEq(math.sqrtWrapper(0), 0);
    }

    function test_sqrt_one() public view {
        assertEq(math.sqrtWrapper(1), 1);
    }

    function test_sqrt_perfectSquares() public view {
        assertEq(math.sqrtWrapper(4), 2);
        assertEq(math.sqrtWrapper(9), 3);
        assertEq(math.sqrtWrapper(16), 4);
        assertEq(math.sqrtWrapper(1e36), 1e18);
    }

    function test_sqrt_nonPerfectSquare() public view {
        // sqrt(2) ≈ 1.414... floor = 1
        assertEq(math.sqrtWrapper(2), 1);
        // sqrt(8) ≈ 2.828... floor = 2
        assertEq(math.sqrtWrapper(8), 2);
    }

    // ============ clearingPrice ============

    function test_clearingPrice_noOrders() public view {
        uint256[] memory empty = new uint256[](0);
        (uint256 price, uint256 vol) = math.calculateClearingPrice(empty, empty, 100 ether, 100 ether);
        // Spot price = 100e18/100e18 * 1e18 = 1e18
        assertEq(price, 1e18);
        assertEq(vol, 0);
    }

    function test_clearingPrice_revertsZeroReserves() public {
        uint256[] memory empty = new uint256[](0);
        vm.expectRevert(BatchMath.InvalidReserves.selector);
        math.calculateClearingPrice(empty, empty, 0, 100 ether);
    }

    function test_clearingPrice_withOrders() public view {
        // Buy orders: [amount=10e18, maxPrice=1.5e18]
        uint256[] memory buys = new uint256[](2);
        buys[0] = 10 ether;
        buys[1] = 1.5e18;

        // Sell orders: [amount=10e18, minPrice=0.5e18]
        uint256[] memory sells = new uint256[](2);
        sells[0] = 10 ether;
        sells[1] = 0.5e18;

        (uint256 price, uint256 vol) = math.calculateClearingPrice(buys, sells, 100 ether, 100 ether);
        // Price should be near spot (1e18) since balanced buy/sell
        assertGt(price, 0.5e18);
        assertLt(price, 1.5e18);
        assertGt(vol, 0);
    }

    // ============ applyGoldenRatioDamping ============

    function test_goldenDamping_withinRange() public view {
        uint256 adjusted = math.applyGoldenRatioDamping(1e18, 1.01e18, 500); // 5% max deviation
        assertEq(adjusted, 1.01e18); // Within range, no damping
    }

    function test_goldenDamping_exceedsRange_up() public view {
        uint256 adjusted = math.applyGoldenRatioDamping(1e18, 2e18, 500); // 5% max, proposed +100%
        // Should be damped: current + (maxDev * PHI / 1e18), but capped at maxDev
        uint256 maxDev = (1e18 * 500) / 10000; // 0.05e18
        assertLe(adjusted, 1e18 + maxDev);
        assertGt(adjusted, 1e18);
    }

    function test_goldenDamping_exceedsRange_down() public view {
        uint256 adjusted = math.applyGoldenRatioDamping(1e18, 0.5e18, 500); // 5% max, proposed -50%
        uint256 maxDev = (1e18 * 500) / 10000;
        assertGe(adjusted, 1e18 - maxDev);
        assertLt(adjusted, 1e18);
    }

    // ============ calculateAMMCapacity ============

    function test_ammCapacity_atSpot() public view {
        uint256 cap = math.calculateAMMCapacity(100 ether, 100 ether, 1e18);
        // At spot, priceRatio = 1e18, capacity = sqrt(100e18*100e18) / (10 * 1e18)
        assertGt(cap, 0);
    }

    function test_ammCapacity_farFromSpot() public view {
        uint256 capNear = math.calculateAMMCapacity(100 ether, 100 ether, 1e18);
        uint256 capFar = math.calculateAMMCapacity(100 ether, 100 ether, 2e18);
        // Farther from spot = lower capacity
        assertGt(capNear, capFar);
    }

    // ============ calculateNetDemand ============

    function test_netDemand_moreBuyers() public view {
        uint256[] memory buys = new uint256[](2);
        buys[0] = 10 ether;
        buys[1] = 1e18; // willing to pay up to 1e18

        uint256[] memory sells = new uint256[](0);

        (int256 nd,) = math.calculateNetDemand(buys, sells, 0.9e18, 100 ether, 100 ether);
        assertGt(nd, 0); // Positive = buy pressure
    }

    function test_netDemand_moreSellers() public view {
        uint256[] memory buys = new uint256[](0);

        uint256[] memory sells = new uint256[](2);
        sells[0] = 10 ether;
        sells[1] = 1e18; // willing to sell at 1e18

        (int256 nd,) = math.calculateNetDemand(buys, sells, 1.1e18, 100 ether, 100 ether);
        assertLt(nd, 0); // Negative = sell pressure
    }
}
