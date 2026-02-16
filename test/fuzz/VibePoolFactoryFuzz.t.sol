// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/amm/VibePoolFactory.sol";
import "../../contracts/amm/interfaces/IPoolCurve.sol";
import "../../contracts/amm/curves/ConstantProductCurve.sol";
import "../../contracts/amm/curves/StableSwapCurve.sol";
import "../../contracts/amm/VibeLP.sol";
import "../../contracts/libraries/BatchMath.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title VibePoolFactory Fuzz Tests
 * @notice Fuzz testing for curve math correctness, fee monotonicity,
 *         and pool creation with random parameters.
 *         Part of VSOS (VibeSwap Operating System) Protocol Framework.
 */
contract VibePoolFactoryFuzzTest is Test {
    VibePoolFactory public factory;
    ConstantProductCurve public cpCurve;
    StableSwapCurve public ssCurve;

    MockToken public tokenA;
    MockToken public tokenB;

    bytes32 public cpId;
    bytes32 public ssId;

    function setUp() public {
        cpCurve = new ConstantProductCurve();
        ssCurve = new StableSwapCurve();
        cpId = cpCurve.CURVE_ID();
        ssId = ssCurve.CURVE_ID();

        factory = new VibePoolFactory(address(0));
        factory.registerCurve(address(cpCurve));
        factory.registerCurve(address(ssCurve));

        tokenA = new MockToken("Token A", "TKA");
        tokenB = new MockToken("Token B", "TKB");
    }

    // ============ CP Curve Fuzz — BatchMath Parity ============

    /// @notice CP getAmountOut must match BatchMath.getAmountOut for all valid inputs
    function testFuzz_cpCurve_getAmountOut_matchesBatchMath(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeRate
    ) public view {
        // Bound to valid ranges
        amountIn = bound(amountIn, 1, 1e30);
        reserveIn = bound(reserveIn, 1e6, 1e35);
        reserveOut = bound(reserveOut, 1e6, 1e35);
        feeRate = bound(feeRate, 0, 9999); // < 10000 to avoid zero fee multiplier

        // Guard against overflow: amountIn * (10000 - feeRate) must not overflow
        // and numerator = amountInWithFee * reserveOut must not overflow
        uint256 amountInWithFee = amountIn * (10000 - feeRate);
        if (amountInWithFee / (10000 - feeRate) != amountIn) return; // overflow check
        if (amountInWithFee > type(uint256).max / reserveOut) return; // overflow check
        uint256 denomCheck = reserveIn * 10000;
        if (denomCheck / 10000 != reserveIn) return; // overflow check

        uint256 curveResult = cpCurve.getAmountOut(amountIn, reserveIn, reserveOut, feeRate, "");
        uint256 batchResult = BatchMath.getAmountOut(amountIn, reserveIn, reserveOut, feeRate);

        assertEq(curveResult, batchResult, "CP getAmountOut must match BatchMath");
    }

    /// @notice CP getAmountIn must match BatchMath.getAmountIn for all valid inputs
    function testFuzz_cpCurve_getAmountIn_matchesBatchMath(
        uint256 amountOut,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeRate
    ) public view {
        reserveIn = bound(reserveIn, 1e6, 1e35);
        reserveOut = bound(reserveOut, 1e6, 1e35);
        amountOut = bound(amountOut, 1, reserveOut - 1); // must be < reserveOut
        feeRate = bound(feeRate, 0, 9999);

        // Guard against overflow in numerator: reserveIn * amountOut * 10000
        if (reserveIn > type(uint256).max / amountOut) return;
        uint256 product = reserveIn * amountOut;
        if (product > type(uint256).max / 10000) return;

        uint256 curveResult = cpCurve.getAmountIn(amountOut, reserveIn, reserveOut, feeRate, "");
        uint256 batchResult = BatchMath.getAmountIn(amountOut, reserveIn, reserveOut, feeRate);

        assertEq(curveResult, batchResult, "CP getAmountIn must match BatchMath");
    }

    // ============ CP Curve Fuzz — Properties ============

    /// @notice Output must always be less than reserveOut (can't drain the pool)
    function testFuzz_cpCurve_outputLessThanReserve(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeRate
    ) public view {
        amountIn = bound(amountIn, 1, 1e30);
        reserveIn = bound(reserveIn, 1e6, 1e35);
        reserveOut = bound(reserveOut, 1e6, 1e35);
        feeRate = bound(feeRate, 0, 9999);

        // Overflow guards
        uint256 amountInWithFee = amountIn * (10000 - feeRate);
        if (amountInWithFee / (10000 - feeRate) != amountIn) return;
        if (amountInWithFee > type(uint256).max / reserveOut) return;
        uint256 denomCheck = reserveIn * 10000;
        if (denomCheck / 10000 != reserveIn) return;

        uint256 amountOut = cpCurve.getAmountOut(amountIn, reserveIn, reserveOut, feeRate, "");
        assertLt(amountOut, reserveOut, "Output must be < reserveOut");
    }

    /// @notice Higher fee → less output (fee monotonicity)
    function testFuzz_cpCurve_feeMonotonicity(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 feeLow,
        uint256 feeHigh
    ) public view {
        amountIn = bound(amountIn, 1e6, 1e28);
        reserveIn = bound(reserveIn, 1e10, 1e33);
        reserveOut = bound(reserveOut, 1e10, 1e33);
        feeLow = bound(feeLow, 0, 4999);
        feeHigh = bound(feeHigh, feeLow + 1, 9999);

        // Overflow guards for higher fee (lower fee will be fine if higher is)
        uint256 amountInWithFee = amountIn * (10000 - feeLow);
        if (amountInWithFee / (10000 - feeLow) != amountIn) return;
        if (amountInWithFee > type(uint256).max / reserveOut) return;
        uint256 denomCheck = reserveIn * 10000;
        if (denomCheck / 10000 != reserveIn) return;

        uint256 outLow = cpCurve.getAmountOut(amountIn, reserveIn, reserveOut, feeLow, "");
        uint256 outHigh = cpCurve.getAmountOut(amountIn, reserveIn, reserveOut, feeHigh, "");

        assertGe(outLow, outHigh, "Lower fee must produce >= output");
    }

    // ============ SS Curve Fuzz — Properties ============

    /// @notice SS getAmountOut must produce positive output for valid inputs
    function testFuzz_ssCurve_producesOutput(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 A
    ) public view {
        // Keep reserves within 100x of each other to avoid Newton convergence issues
        reserveIn = bound(reserveIn, 1e18, 1e28);
        reserveOut = bound(reserveOut, reserveIn / 100, reserveIn * 100);
        if (reserveOut < 1e16) reserveOut = 1e16;
        // amountIn must be small relative to reserves for convergence
        amountIn = bound(amountIn, 1e12, reserveOut / 2);
        A = bound(A, 1, 10000);

        bytes memory params = abi.encode(A);

        uint256 amountOut = ssCurve.getAmountOut(amountIn, reserveIn, reserveOut, 0, params);
        assertGt(amountOut, 0, "SS must produce positive output");
    }

    /// @notice SS output must always be less than reserveOut
    function testFuzz_ssCurve_outputLessThanReserve(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 A
    ) public view {
        // Keep reserves within 100x of each other to avoid Newton convergence issues
        reserveIn = bound(reserveIn, 1e18, 1e28);
        reserveOut = bound(reserveOut, reserveIn / 100, reserveIn * 100);
        if (reserveOut < 1e16) reserveOut = 1e16;
        amountIn = bound(amountIn, 1e12, reserveOut / 2);
        A = bound(A, 1, 10000);

        bytes memory params = abi.encode(A);

        uint256 amountOut = ssCurve.getAmountOut(amountIn, reserveIn, reserveOut, 0, params);
        assertLt(amountOut, reserveOut, "SS output must be < reserveOut");
    }

    /// @notice SS with balanced reserves and high A should produce near-peg output
    function testFuzz_ssCurve_nearPegWithHighA(
        uint256 reserve,
        uint256 amountIn,
        uint256 A
    ) public view {
        reserve = bound(reserve, 1e20, 1e30);
        amountIn = bound(amountIn, 1e12, reserve / 100); // small trade relative to reserves
        A = bound(A, 100, 10000);

        bytes memory params = abi.encode(A);

        uint256 amountOut = ssCurve.getAmountOut(amountIn, reserve, reserve, 0, params);

        // With balanced reserves and A >= 100, output should be > 99% of input
        assertGt(amountOut, amountIn * 99 / 100, "SS near-peg: output should be > 99% of input");
    }

    /// @notice SS fee monotonicity: higher fee → less output
    function testFuzz_ssCurve_feeMonotonicity(
        uint256 amountIn,
        uint256 reserve,
        uint256 A,
        uint256 feeLow,
        uint256 feeHigh
    ) public view {
        reserve = bound(reserve, 1e18, 1e28);
        amountIn = bound(amountIn, 1e12, reserve / 10);
        A = bound(A, 10, 5000);
        feeLow = bound(feeLow, 0, 499);
        feeHigh = bound(feeHigh, feeLow + 1, 500);

        bytes memory params = abi.encode(A);

        uint256 outLow = ssCurve.getAmountOut(amountIn, reserve, reserve, feeLow, params);
        uint256 outHigh = ssCurve.getAmountOut(amountIn, reserve, reserve, feeHigh, params);

        assertGe(outLow, outHigh, "SS: lower fee must produce >= output");
    }

    /// @notice SS roundtrip should not create value (trade A→B then B→A)
    function testFuzz_ssCurve_noValueCreation(
        uint256 reserve,
        uint256 amountIn,
        uint256 A
    ) public view {
        reserve = bound(reserve, 1e20, 1e30);
        amountIn = bound(amountIn, 1e14, reserve / 10);
        A = bound(A, 10, 5000);

        bytes memory params = abi.encode(A);

        // Forward: trade amountIn → outB
        uint256 outB = ssCurve.getAmountOut(amountIn, reserve, reserve, 0, params);
        if (outB == 0) return;

        // Reverse: trade outB → backA with updated reserves
        uint256 newReserveA = reserve + amountIn;
        uint256 newReserveB = reserve - outB;
        if (newReserveB == 0) return;

        uint256 backA = ssCurve.getAmountOut(outB, newReserveB, newReserveA, 0, params);

        // Conservation: roundtrip should not create value (1 wei tolerance for Newton rounding)
        assertLe(backA, amountIn + 1, "SS roundtrip must not create value (1 wei tolerance)");
    }

    // ============ Pool Creation Fuzz ============

    /// @notice Random valid fee rates should produce correctly configured pools
    function testFuzz_createPool_validFeeRate(uint16 feeRate) public {
        feeRate = uint16(bound(feeRate, 1, 1000)); // 0.01% to 10%

        bytes32 poolId = factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            curveId: cpId,
            feeRate: feeRate,
            curveParams: "",
            hook: address(0),
            hookFlags: 0
        }));

        VibePoolFactory.FactoryPool memory pool = factory.getPool(poolId);
        assertEq(pool.feeRate, feeRate);
        assertTrue(pool.initialized);
    }

    /// @notice Random valid amplification coefficients should produce SS pools
    function testFuzz_createPool_SS_validAmp(uint256 A) public {
        A = bound(A, 1, 10000);

        bytes32 poolId = factory.createPool(VibePoolFactory.CreatePoolParams({
            tokenA: address(tokenA),
            tokenB: address(tokenB),
            curveId: ssId,
            feeRate: 0,
            curveParams: abi.encode(A),
            hook: address(0),
            hookFlags: 0
        }));

        assertTrue(factory.getPool(poolId).initialized);
    }

    /// @notice SS validateParams should reject all A values outside [1, 10000]
    function testFuzz_ssCurve_validateParams_outOfRange(uint256 A) public view {
        // Only test values outside the valid range
        vm.assume(A == 0 || A > 10000);

        assertFalse(ssCurve.validateParams(abi.encode(A)));
    }

    /// @notice SS validateParams should accept all A values in [1, 10000]
    function testFuzz_ssCurve_validateParams_inRange(uint256 A) public view {
        A = bound(A, 1, 10000);

        assertTrue(ssCurve.validateParams(abi.encode(A)));
    }
}
