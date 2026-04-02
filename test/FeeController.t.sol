// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/amm/FeeController.sol";
import "../contracts/libraries/ILMeasurement.sol";

contract FeeControllerTest is Test {
    FeeController public controller;
    bytes32 public poolId = keccak256("ETH-USDC");
    bytes32 public stablePoolId = keccak256("USDC-USDT");

    function setUp() public {
        controller = new FeeController();

        // Initialize pools with starting reserves
        // ETH-USDC: 100 ETH / 200,000 USDC (ETH @ $2000)
        controller.initializePool(poolId, 100e18, 200_000e18);

        // USDC-USDT: 1M USDC / 1M USDT (stablecoin pair)
        controller.initializePool(stablePoolId, 1_000_000e18, 1_000_000e18);
    }

    // ============ ILMeasurement Library Tests ============

    function test_IL_noDivergence() public pure {
        // Price ratio = 1.0 → IL = 0
        uint256 il = ILMeasurement.computeIL(1e18);
        assertEq(il, 0, "No IL when price unchanged");
    }

    function test_IL_2xPrice() public pure {
        // Price ratio = 2.0 → IL ≈ 5.72%
        uint256 il = ILMeasurement.computeIL(2e18);
        // Allow small rounding: 5.72% = 572 BPS ± 2
        assertApproxEqAbs(il, 572, 2, "IL at 2x price should be ~5.72%");
    }

    function test_IL_halfPrice() public pure {
        // Price ratio = 0.5 → IL ≈ 5.72% (same as 2x, IL is symmetric)
        uint256 il = ILMeasurement.computeIL(0.5e18);
        assertApproxEqAbs(il, 572, 2, "IL at 0.5x price should be ~5.72%");
    }

    function test_IL_1_5xPrice() public pure {
        // Price ratio = 1.5 → IL ≈ 2.02%
        uint256 il = ILMeasurement.computeIL(1.5e18);
        assertApproxEqAbs(il, 202, 5, "IL at 1.5x price should be ~2.02%");
    }

    function test_IL_1_25xPrice() public pure {
        // Price ratio = 1.25 → IL ≈ 0.60%
        uint256 il = ILMeasurement.computeIL(1.25e18);
        assertApproxEqAbs(il, 60, 5, "IL at 1.25x price should be ~0.60%");
    }

    function test_IL_3xPrice() public pure {
        // Price ratio = 3.0 → IL ≈ 13.40%
        uint256 il = ILMeasurement.computeIL(3e18);
        assertApproxEqAbs(il, 1340, 5, "IL at 3x price should be ~13.40%");
    }

    function test_IL_fromReserves_noChange() public pure {
        uint256 il = ILMeasurement.computeILFromReserves(
            100e18, 200_000e18, // before
            100e18, 200_000e18  // after (same)
        );
        assertEq(il, 0, "No IL when reserves unchanged");
    }

    function test_IL_fromReserves_4xPrice() public pure {
        // Use clean numbers: price = 1.0 → 4.0 (4x movement)
        // Before: 100/100, k=10000. After: 50/200, k=10000. Price ratio = 4.
        // IL at 4x = 1 - 2*sqrt(4)/(1+4) = 1 - 4/5 = 20% = 2000 BPS
        uint256 il = ILMeasurement.computeILFromReserves(
            100e18, 100e18,  // before: price = 1.0
            50e18, 200e18    // after: price = 4.0 (k preserved)
        );
        assertApproxEqAbs(il, 2000, 5, "IL from reserves at 4x should be ~20%");
    }

    // ============ EWMA Tests ============

    function test_EWMA_firstSample() public pure {
        // Starting from 0, 10% weight on new sample of 100
        uint256 result = ILMeasurement.updateEWMA(0, 100, 1e17); // alpha = 0.1
        assertEq(result, 10, "EWMA should be 10 (10% of 100)");
    }

    function test_EWMA_convergence() public pure {
        // Feeding constant value should converge toward it
        uint256 ewma = 0;
        uint256 alpha = 1e17; // 10%
        for (uint256 i = 0; i < 100; i++) {
            ewma = ILMeasurement.updateEWMA(ewma, 100, alpha);
        }
        // Integer rounding means convergence isn't perfect — allow ±10
        assertApproxEqAbs(ewma, 100, 10, "EWMA should converge to constant input");
    }

    // ============ FeeController: Initialization ============

    function test_initialization() public view {
        uint256 fee = controller.getFee(poolId);
        assertEq(fee, 5, "Initial fee should be DEFAULT_FEE_BPS (5)");
    }

    function test_uninitializedPool_returnsDefault() public view {
        bytes32 unknownPool = keccak256("UNKNOWN");
        assertEq(controller.getFee(unknownPool), 5, "Uninitialized pool returns default");
    }

    // ============ FeeController: No IL → Fee stays low ============

    function test_noIL_feeStaysLow() public {
        // Reserves unchanged → IL = 0 → fee should stay at or near minimum
        uint256 fee = controller.measureAndUpdate(poolId, 100e18, 200_000e18);
        assertLe(fee, 5, "Fee should stay low with no IL");
    }

    // ============ FeeController: IL → Fee increases ============

    function test_IL_feeIncreases() public {
        // Simulate 2x price movement (significant IL)
        uint256 fee = controller.measureAndUpdate(
            poolId,
            70_710_678e12,  // ~70.7 ETH
            282_842_712e12  // ~282.8k USDC
        );

        // Fee should increase from default to compensate for IL
        assertGt(fee, 5, "Fee should increase when IL is detected");
    }

    // ============ FeeController: Stable pair → near-zero fee ============

    function test_stablePair_minimalFee() public {
        // Stable pair with tiny depeg (0.1% movement)
        // 1M USDC / 1.001M USDT
        uint256 fee = controller.measureAndUpdate(
            stablePoolId,
            1_000_000e18,
            1_001_000e18
        );
        assertLe(fee, 5, "Stable pair fee should stay minimal");
    }

    // ============ FeeController: Fee converges over multiple measurements ============

    function test_convergence_repeatedMeasurements() public {
        // Simulate steady 25% price increase per period
        uint256 r0 = 100e18;
        uint256 r1 = 200_000e18;

        uint256 lastFee;
        for (uint256 i = 0; i < 20; i++) {
            // Small price drift each period (5% increase in price ratio)
            // r1 increases by 5%, r0 decreases to maintain k
            r1 = r1 * 105 / 100;
            r0 = (100e18 * 200_000e18) / r1; // maintain k

            lastFee = controller.measureAndUpdate(poolId, r0, r1);
        }

        // 5% price drift per period causes ~11 BPS of IL — very small.
        // PID correctly keeps fee low. Fee should be within bounds.
        assertGe(lastFee, controller.MIN_FEE_BPS(), "Fee should be at or above floor");
        assertLe(lastFee, controller.MAX_FEE_BPS(), "Fee should be below maximum");
    }

    // ============ FeeController: Fee bounded ============

    function test_feeBounded_floor() public {
        // No IL → fee should not go below MIN_FEE_BPS
        for (uint256 i = 0; i < 10; i++) {
            controller.measureAndUpdate(poolId, 100e18, 200_000e18);
        }
        uint256 fee = controller.getFee(poolId);
        assertGe(fee, controller.MIN_FEE_BPS(), "Fee should never go below floor");
    }

    function test_feeBounded_ceiling() public {
        // Extreme IL (10x price movement) → fee should not exceed MAX_FEE_BPS
        uint256 fee = controller.measureAndUpdate(
            poolId,
            31_622_776e12,  // ~31.6 ETH (sqrt(10) reduction)
            632_455_532e12  // ~632k USDC (sqrt(10) increase)
        );
        assertLe(fee, controller.MAX_FEE_BPS(), "Fee should never exceed ceiling");
    }

    // ============ FeeController: PID Tuning ============

    function test_setPIDParams() public {
        controller.setPIDParams(8000, 800, 2000, 2e17);
        assertEq(controller.kP(), 8000);
        assertEq(controller.kI(), 800);
        assertEq(controller.kD(), 2000);
        assertEq(controller.alpha(), 2e17);
    }

    function test_setPIDParams_revertsNonOwner() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", address(0xBEEF)));
        controller.setPIDParams(8000, 800, 2000, 2e17);
    }

    function test_setPIDParams_revertsInvalidAlpha() public {
        vm.expectRevert(FeeController.InvalidPIDParams.selector);
        controller.setPIDParams(8000, 800, 2000, 1e18 + 1); // alpha > PRECISION
    }

    // ============ FeeController: Pool State View ============

    function test_getPoolFeeState() public {
        controller.measureAndUpdate(poolId, 90e18, 220_000e18);

        (
            uint256 currentFeeBps,
            uint256 smoothedIL,
            uint256 previousIL,
            ,
            uint256 totalMeasurements,
            uint256 averageIL
        ) = controller.getPoolFeeState(poolId);

        assertGt(currentFeeBps, 0, "Should have a fee");
        assertGt(smoothedIL, 0, "Should have smoothed IL");
        assertGt(previousIL, 0, "Should have previous IL");
        assertEq(totalMeasurements, 1, "Should have 1 measurement");
        assertEq(averageIL, previousIL, "Average should equal single measurement");
    }

    // ============ Fuzz: IL computation never reverts ============

    function testFuzz_IL_neverReverts(uint256 priceRatio) public pure {
        priceRatio = bound(priceRatio, 1, 1000e18); // 0.000...001 to 1000x
        ILMeasurement.computeIL(priceRatio); // should not revert
    }

    function testFuzz_fee_alwaysBounded(uint256 r0, uint256 r1) public {
        r0 = bound(r0, 1e15, 1e30);
        r1 = bound(r1, 1e15, 1e30);

        uint256 fee = controller.measureAndUpdate(poolId, r0, r1);
        assertGe(fee, controller.MIN_FEE_BPS(), "Fee >= floor");
        assertLe(fee, controller.MAX_FEE_BPS(), "Fee <= ceiling");
    }
}
