// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/TruePriceLib.sol";
import "../../contracts/oracles/interfaces/ITruePriceOracle.sol";

contract TruePriceFuzzWrapper {
    function validatePriceDeviation(uint256 spot, uint256 tp, uint256 maxBps)
        external pure returns (bool)
    { return TruePriceLib.validatePriceDeviation(spot, tp, maxBps); }

    function adjustDeviationForStablecoin(uint256 base, bool usdt, bool usdc)
        external pure returns (uint256)
    { return TruePriceLib.adjustDeviationForStablecoin(base, usdt, usdc); }

    function zScoreToReversionProbability(int256 z, bool usdt)
        external pure returns (uint256)
    { return TruePriceLib.zScoreToReversionProbability(z, usdt); }

    function abs_(int256 x) external pure returns (uint256)
    { return TruePriceLib.abs(x); }
}

contract TruePriceLibFuzzTest is Test {
    TruePriceFuzzWrapper lib;

    function setUp() public {
        lib = new TruePriceFuzzWrapper();
    }

    // ============ Fuzz: zero truePrice always passes ============
    function testFuzz_deviation_zeroTruePrice(uint256 spot, uint256 maxBps) public view {
        spot = bound(spot, 0, 1e30);
        maxBps = bound(maxBps, 0, 10000);
        assertTrue(lib.validatePriceDeviation(spot, 0, maxBps));
    }

    // ============ Fuzz: equal prices always pass ============
    function testFuzz_deviation_equalPrices(uint256 price, uint256 maxBps) public view {
        price = bound(price, 1, 1e30);
        maxBps = bound(maxBps, 0, 10000);
        assertTrue(lib.validatePriceDeviation(price, price, maxBps));
    }

    // ============ Fuzz: USDT deviation is always tighter than base ============
    function testFuzz_usdtTighter(uint256 base) public view {
        base = bound(base, 1, 10000);
        uint256 usdt = lib.adjustDeviationForStablecoin(base, true, false);
        assertLe(usdt, base);
    }

    // ============ Fuzz: USDC deviation is always looser than base ============
    function testFuzz_usdcLooser(uint256 base) public view {
        base = bound(base, 1, 10000);
        uint256 usdc = lib.adjustDeviationForStablecoin(base, false, true);
        assertGe(usdc, base);
    }

    // ============ Fuzz: z-score reversion probability bounded [0, 1e18] ============
    function testFuzz_zScore_bounded(int256 z, bool usdt) public view {
        z = bound(z, -100e18, 100e18);
        uint256 prob = lib.zScoreToReversionProbability(z, usdt);
        assertLe(prob, 1e18);
    }

    // ============ Fuzz: z-score symmetry (positive and negative produce same result) ============
    function testFuzz_zScore_symmetric(int256 z, bool usdt) public view {
        z = bound(z, 1, 100e18);
        uint256 pos = lib.zScoreToReversionProbability(z, usdt);
        uint256 neg = lib.zScoreToReversionProbability(-z, usdt);
        assertEq(pos, neg);
    }

    // ============ Fuzz: z-score monotonically increases with |z| ============
    function testFuzz_zScore_monotonic(int256 z1, int256 z2) public view {
        z1 = bound(z1, 0, 50e18);
        z2 = bound(z2, z1, 50e18);
        uint256 p1 = lib.zScoreToReversionProbability(z1, false);
        uint256 p2 = lib.zScoreToReversionProbability(z2, false);
        assertGe(p2, p1);
    }

    // ============ Fuzz: abs property ============
    function testFuzz_abs(int256 x) public view {
        x = bound(x, type(int256).min + 1, type(int256).max);
        uint256 result = lib.abs_(x);
        assertGe(result, 0);
        if (x >= 0) {
            assertEq(result, uint256(x));
        } else {
            assertEq(result, uint256(-x));
        }
    }
}
