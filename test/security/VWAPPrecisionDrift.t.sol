// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/VWAPOracle.sol";

/**
 * @title VWAPPrecisionDrift
 * @notice Demonstrates and guards against asymmetric truncation between
 *         priceCumulative and volumeCumulative in VWAPOracle.recordTrade.
 *
 * @dev BACKGROUND (C19-F1):
 *   recordTrade originally computed:
 *     priceContribution     = (price/1e12) * volume / 1e18   // truncates after multiplication
 *     volumeCumulative     += volume / 1e18                   // truncates BEFORE summing
 *
 *   The two cumulators truncate volume at different stages. For trades with
 *   volume < 1e18 (any sub-1-token trade for an 18-decimal token, or any
 *   non-trivial amount for low-decimal tokens like USDC-6), the
 *   priceContribution non-zero accumulates while volumeCumulative does not.
 *
 *   This produces a one-sided bias in VWAP: every dust trade pushes
 *   priceCumulative without matching volume, distorting subsequent VWAP
 *   reads. After many dust trades the consult() result drifts away from
 *   the volume-weighted truth.
 *
 *   Worked example (pre-fix):
 *     baseline: 4 trades (price=$1000, vol=10 tokens=1e19)
 *       => priceCum += 4 * (1000e18/1e12) * 1e19 / 1e18 = 4e10
 *       => volCum   += 4 * (1e19/1e18) = 40
 *     dust:     N trades (price=$5000, vol=0.5 token=5e17)
 *       => priceCum += N * (5000e18/1e12) * 5e17 / 1e18 = N * 2.5e9
 *       => volCum   += N * (5e17/1e18) = 0   (asymmetric!)
 *
 *     With N=10 dust trades, priceCum drifts by 2.5e10 (62% of baseline)
 *     while volCum stays at 40, biasing VWAP toward the dust price.
 */

// Harness mirrors test/libraries/VWAPOracle.t.sol shape.
contract VWAPDriftHarness {
    VWAPOracle.VWAPState public state;

    function initialize(uint256 initialPrice) external {
        VWAPOracle.initialize(state, initialPrice);
    }

    function recordTrade(uint256 price, uint256 volume) external {
        VWAPOracle.recordTrade(state, price, volume);
    }

    function grow(uint16 newCardinality) external {
        VWAPOracle.grow(state, newCardinality);
    }

    function consult(uint32 period) external view returns (uint256) {
        return VWAPOracle.consult(state, period);
    }

    function getCurrentCumulatives() external view returns (uint128 pc, uint128 vc) {
        return VWAPOracle.getCurrentCumulatives(state);
    }
}

contract VWAPPrecisionDriftTest is Test {
    VWAPDriftHarness public oracle;

    uint256 constant PRICE_SCALE = 1e12;
    uint256 constant PRECISION   = 1e18;
    uint32  constant MIN_PERIOD  = 1 minutes;

    function setUp() public {
        vm.warp(2 days);
        oracle = new VWAPDriftHarness();
        oracle.initialize(1000e18);
        oracle.grow(200);
    }

    // ============ C19-F1: Asymmetric truncation guard ============

    /**
     * @notice After the fix, sub-PRECISION volume trades must NOT pollute
     *         priceCumulative. Either both cumulators move or neither does.
     *
     *         Pre-fix: priceCumulative grows on dust trades while
     *         volumeCumulative stays — the cumulators desync.
     *
     *         Post-fix: dust trades return early before either cumulator
     *         moves, so they remain in lockstep.
     */
    function test_dustTrades_doNotMovePriceCumulativeWithoutVolume() public {
        // Establish baseline volume so volCum > 0
        vm.warp(block.timestamp + 15);
        oracle.recordTrade(1000e18, 1e19);  // 10 tokens at $1000

        (uint128 pcBefore, uint128 vcBefore) = oracle.getCurrentCumulatives();

        // 50 sub-PRECISION dust trades at a wildly off price.
        // Pre-fix: priceCum drifts while vc stays.
        // Post-fix: both stay (early return on scaledVolume == 0).
        for (uint256 i = 0; i < 50; i++) {
            vm.warp(block.timestamp + 1);
            oracle.recordTrade(5000e18, 5e17); // 0.5 token at $5000
        }

        (uint128 pcAfter, uint128 vcAfter) = oracle.getCurrentCumulatives();

        // INVARIANT: if volumeCumulative did not advance, priceCumulative
        // must not have advanced either (dust must be a true no-op).
        if (vcAfter == vcBefore) {
            assertEq(
                pcAfter,
                pcBefore,
                "C19-F1: priceCum drifted while volCum stayed (asymmetric truncation)"
            );
        }
    }

    /**
     * @notice Quantitative drift: with the pre-fix asymmetry, repeated dust
     *         trades at an off price should bias the resulting VWAP toward
     *         the dust price. Post-fix, VWAP should stay anchored at the
     *         honest baseline.
     */
    function test_vwap_resistsBiasFromDustTrades() public {
        uint32 step = MIN_PERIOD / 4; // 15s

        // Baseline: 4 honest trades at $1000 with 10-token volume.
        for (uint256 i = 0; i < 4; i++) {
            vm.warp(block.timestamp + step);
            oracle.recordTrade(1000e18, 1e19);
        }

        uint256 baseline = oracle.consult(MIN_PERIOD);

        // Attacker: 20 dust trades at $5000 with 0.5-token volume each.
        // Pre-fix: priceCumulative drifts ~50% of baseline; VWAP visibly
        //          biased toward $5000.
        // Post-fix: dust trades are no-ops; VWAP unchanged.
        for (uint256 i = 0; i < 20; i++) {
            vm.warp(block.timestamp + 1);
            oracle.recordTrade(5000e18, 5e17);
        }

        uint256 postDust = oracle.consult(MIN_PERIOD);

        // After fix, VWAP should be approximately equal to baseline.
        // Tolerance generous (5%) to allow for legitimate rounding from the
        // intentional cumulative-window slide.
        assertApproxEqRel(
            postDust,
            baseline,
            5e16,
            "C19-F1: VWAP drifted under dust attack (asymmetric truncation)"
        );
    }
}
