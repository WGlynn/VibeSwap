// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/LiquidityProtection.sol";

contract LiqProtFuzzWrapper {
    function calculateVirtualReserves(uint256 r0, uint256 r1, uint256 amp)
        external pure returns (uint256, uint256)
    { return LiquidityProtection.calculateVirtualReserves(r0, r1, amp); }

    function getAmountOutWithVirtualReserves(uint256 aIn, uint256 rIn, uint256 rOut, uint256 amp, uint256 fee)
        external pure returns (uint256)
    { return LiquidityProtection.getAmountOutWithVirtualReserves(aIn, rIn, rOut, amp, fee); }

    function calculateDynamicFee(uint256 liq, uint256 vol, uint256 baseFee)
        external pure returns (uint256)
    { return LiquidityProtection.calculateDynamicFee(liq, vol, baseFee); }

    function calculatePriceImpact(uint256 aIn, uint256 rIn, uint256 rOut)
        external pure returns (uint256)
    { return LiquidityProtection.calculatePriceImpact(aIn, rIn, rOut); }

    function getMaxTradeSize(uint256 rIn, uint256 maxBps)
        external pure returns (uint256)
    { return LiquidityProtection.getMaxTradeSize(rIn, maxBps); }
}

contract LiquidityProtectionFuzzTest is Test {
    LiqProtFuzzWrapper lib;

    function setUp() public {
        lib = new LiqProtFuzzWrapper();
    }

    // ============ Fuzz: INV1 — virtual reserves reduce price impact ============
    function testFuzz_INV1_virtualReducesImpact(uint256 amountIn, uint256 reserve) public view {
        amountIn = bound(amountIn, 1e15, 1e24);
        reserve = bound(reserve, 1e18, 1e30);

        uint256 out1 = lib.getAmountOutWithVirtualReserves(amountIn, reserve, reserve, 1, 30);
        uint256 out10 = lib.getAmountOutWithVirtualReserves(amountIn, reserve, reserve, 10, 30);
        // Higher amplification → more output (less impact)
        assertGe(out10, out1);
    }

    // ============ Fuzz: INV2 — dynamic fees monotonic ============
    function testFuzz_INV2_feesMonotonic(uint256 liq1, uint256 liq2) public view {
        liq1 = bound(liq1, 1e18, 1e26);
        liq2 = bound(liq2, liq1, 1e26);
        uint256 fee1 = lib.calculateDynamicFee(liq1, 0, 30);
        uint256 fee2 = lib.calculateDynamicFee(liq2, 0, 30);
        // Higher liquidity → lower or equal fee
        assertLe(fee2, fee1);
    }

    // ============ Fuzz: dynamic fee bounded by MAX_FEE_BPS ============
    function testFuzz_dynamicFee_capped(uint256 liq, uint256 vol) public view {
        liq = bound(liq, 1, 1e30);
        vol = bound(vol, 0, 1e30);
        uint256 fee = lib.calculateDynamicFee(liq, vol, 30);
        assertLe(fee, 500); // MAX_FEE_BPS
    }

    // ============ Fuzz: price impact < 10000 bps (< 100%) ============
    function testFuzz_priceImpact_bounded(uint256 amountIn, uint256 rIn) public view {
        amountIn = bound(amountIn, 1, 1e30);
        rIn = bound(rIn, 1, 1e30);
        uint256 impact = lib.calculatePriceImpact(amountIn, rIn, 1e30);
        assertLt(impact, 10000);
    }

    // ============ Fuzz: price impact monotonic with amountIn ============
    function testFuzz_priceImpact_monotonic(uint256 a1, uint256 a2, uint256 rIn) public view {
        rIn = bound(rIn, 1e18, 1e30);
        a1 = bound(a1, 1, 1e24);
        a2 = bound(a2, a1, 1e24);
        uint256 i1 = lib.calculatePriceImpact(a1, rIn, rIn);
        uint256 i2 = lib.calculatePriceImpact(a2, rIn, rIn);
        assertGe(i2, i1);
    }

    // ============ Fuzz: virtual reserves scale linearly ============
    function testFuzz_virtualReserves_linear(uint256 r0, uint256 r1, uint256 amp) public view {
        r0 = bound(r0, 1, 1e24);
        r1 = bound(r1, 1, 1e24);
        amp = bound(amp, 1, 1000);
        (uint256 e0, uint256 e1) = lib.calculateVirtualReserves(r0, r1, amp);
        assertEq(e0, r0 * amp);
        assertEq(e1, r1 * amp);
    }

    // ============ Fuzz: max trade size at impact limit produces correct impact ============
    function testFuzz_maxTradeSize_producesExpectedImpact(uint256 rIn, uint256 maxBps) public view {
        rIn = bound(rIn, 1e18, 1e30);
        maxBps = bound(maxBps, 1, 9999);
        uint256 maxTrade = lib.getMaxTradeSize(rIn, maxBps);
        uint256 impact = lib.calculatePriceImpact(maxTrade, rIn, rIn);
        // Impact should be <= maxBps (with some rounding tolerance)
        assertLe(impact, maxBps + 1);
    }
}
