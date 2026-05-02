// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/VWAPOracle.sol";

/// @notice Wrapper exposing the VWAPOracle library functions for fuzzing.
contract VWAPPrecisionWrapper {
    using VWAPOracle for VWAPOracle.VWAPState;
    VWAPOracle.VWAPState public state;

    function initialize(uint256 price) external { state.initialize(price); }
    function recordTrade(uint256 price, uint256 volume) external { state.recordTrade(price, volume); }
    function grow(uint16 newCard) external { state.grow(newCard); }
    function consult(uint32 period) external view returns (uint256) {
        return state.consult(period);
    }
    function getLastPrice() external view returns (uint256) {
        return state.getLastPrice();
    }
    function getCurrentCumulatives() external view returns (uint128 priceCum, uint128 volCum) {
        return state.getCurrentCumulatives();
    }
}

/// @title VWAPOracle C19-F1 Precision Fuzz
/// @notice Property tests for the C19-F1 dust-trade-bias fix.
///
/// Pre-fix bug: when `volume < PRECISION (1e18)`, `recordTrade` accumulated a
/// non-zero `priceContribution` while `volumeCumulative` got nothing because
/// the two cumulators truncated at different stages:
///     priceContribution = scaledPrice * volume / PRECISION  (kept the price bits)
///     volumeCumulative += volume / PRECISION                (rounded to zero)
/// This biased the VWAP toward the prices of dust trades.
///
/// Post-fix property: dust trades (`scaledVolume == volume / PRECISION == 0`)
/// are no-ops on both cumulators — they only update `lastPrice` for the
/// fallback-query path. Trades with `scaledVolume >= 1` accumulate symmetrically
/// in both cumulators, so the consulted VWAP equals the true volume-weighted
/// mean within a tight ULP envelope dominated by integer truncation, NOT by
/// dust-injection bias.
contract VWAPOraclePrecisionFuzz is Test {
    uint256 constant PRECISION = 1e18;
    uint256 constant PRICE_SCALE = 1e12;
    uint32 constant PERIOD = 2 minutes;

    /// @notice C19-F1 PROPERTY: dust trades (volume < PRECISION) MUST NOT change
    ///         either cumulator. Pre-fix this property failed for every dust
    ///         trade. Post-fix it holds for any (price, dust-volume) pair.
    function testFuzz_dustTradeIsNoOp(
        uint256 dustVolume,
        uint256 dustPrice
    ) public {
        // Constrain dustVolume strictly below PRECISION — the dust regime.
        dustVolume = bound(dustVolume, 0, PRECISION - 1);
        dustPrice = bound(dustPrice, 1e13, 1e22);

        VWAPPrecisionWrapper oracle = new VWAPPrecisionWrapper();
        oracle.initialize(dustPrice);
        oracle.grow(64);

        // Seed with a non-dust trade so cumulators have a nonzero baseline.
        uint256 seedPrice = 1e18;
        uint256 seedVolume = 5 * PRECISION;
        vm.warp(block.timestamp + 30 seconds);
        oracle.recordTrade(seedPrice, seedVolume);

        (uint128 priceCumBefore, uint128 volCumBefore) = oracle.getCurrentCumulatives();

        // Inject the dust trade. Must be a no-op on cumulators.
        vm.warp(block.timestamp + 1 seconds);
        oracle.recordTrade(dustPrice, dustVolume);

        (uint128 priceCumAfter, uint128 volCumAfter) = oracle.getCurrentCumulatives();

        // BOTH cumulators must match — symmetrical truncation property.
        assertEq(priceCumAfter, priceCumBefore, "C19-F1: dust trade polluted priceCumulative");
        assertEq(volCumAfter, volCumBefore, "C19-F1: dust trade changed volumeCumulative");
    }

    /// @notice DIFFERENTIAL property: two oracles fed an identical sequence of
    ///         non-dust trades, where one ALSO sees an interleaved dust trade
    ///         at an arbitrary price, must end with bit-identical cumulators.
    ///         This is the precise C19-F1 contract: dust must be invisible.
    ///
    ///         Pre-fix this would fail because the dust-fed oracle's
    ///         priceCumulative would have absorbed `scaledDustPrice * dustVol /
    ///         PRECISION` while its volumeCumulative gained nothing.
    function testFuzz_dustVsNoDustCumulatorsIdentical(
        uint256 priceRaw,
        uint256 dustPriceRaw,
        uint256 dustVolRaw
    ) public {
        uint256 price = bound(priceRaw, 1e15, 1e20);
        uint256 dustPrice = bound(dustPriceRaw, 1e13, 1e22);
        uint256 dustVol = bound(dustVolRaw, 1, PRECISION - 1);
        uint256 vol = 10 * PRECISION;

        VWAPPrecisionWrapper a = new VWAPPrecisionWrapper();
        VWAPPrecisionWrapper b = new VWAPPrecisionWrapper();
        a.initialize(price); a.grow(64);
        b.initialize(price); b.grow(64);

        // Sequence: 2 real trades, both oracles in sync.
        vm.warp(block.timestamp + 30 seconds);
        a.recordTrade(price, vol);
        b.recordTrade(price, vol);

        // Only oracle B sees the dust trade.
        vm.warp(block.timestamp + 1 seconds);
        b.recordTrade(dustPrice, dustVol);

        vm.warp(block.timestamp + 30 seconds);
        a.recordTrade(price, vol);
        b.recordTrade(price, vol);

        // Cumulators must be IDENTICAL — the dust must vanish into the no-op
        // branch and never touch either accumulator.
        (uint128 pcA, uint128 vcA) = a.getCurrentCumulatives();
        (uint128 pcB, uint128 vcB) = b.getCurrentCumulatives();

        assertEq(pcA, pcB, "C19-F1: dust polluted priceCumulative differential");
        assertEq(vcA, vcB, "C19-F1: dust shifted volumeCumulative differential");
    }

    /// @notice MIDPOINT DIFFERENTIAL: a midpoint-style scenario (two equal-
    ///         volume trades at p1, p2) with dust interleaved must produce
    ///         the same cumulator state as the same scenario WITHOUT dust.
    ///         This proves dust never enters the weighted-mean computation
    ///         regardless of where in the sequence it lands.
    function testFuzz_dustVsNoDustMidpointCumulators(
        uint256 p1Raw,
        uint256 p2Raw,
        uint256 dustPriceRaw,
        uint256 dustVolRaw
    ) public {
        uint256 p1 = bound(p1Raw, 1e15, 1e21);
        uint256 p2 = bound(p2Raw, 1e15, 1e21);
        uint256 dustPrice = bound(dustPriceRaw, 1e13, 1e22);
        uint256 dustVol = bound(dustVolRaw, 1, PRECISION - 1);
        uint256 vol = 10 * PRECISION;

        VWAPPrecisionWrapper a = new VWAPPrecisionWrapper();
        VWAPPrecisionWrapper b = new VWAPPrecisionWrapper();
        a.initialize((p1 + p2) / 2); a.grow(64);
        b.initialize((p1 + p2) / 2); b.grow(64);

        vm.warp(block.timestamp + 20 seconds);
        a.recordTrade(p1, vol);
        b.recordTrade(p1, vol);

        // Dust on B only.
        vm.warp(block.timestamp + 1 seconds);
        b.recordTrade(dustPrice, dustVol);

        vm.warp(block.timestamp + 20 seconds);
        a.recordTrade(p2, vol);
        b.recordTrade(p2, vol);

        // More dust on B.
        vm.warp(block.timestamp + 1 seconds);
        b.recordTrade(dustPrice, dustVol);

        (uint128 pcA, uint128 vcA) = a.getCurrentCumulatives();
        (uint128 pcB, uint128 vcB) = b.getCurrentCumulatives();

        assertEq(pcA, pcB, "C19-F1: dust polluted midpoint priceCumulative");
        assertEq(vcA, vcB, "C19-F1: dust polluted midpoint volumeCumulative");
    }

    /// @notice MULTI-DUST property: arbitrarily many dust trades, at any prices,
    ///         in any order between non-dust trades, must leave the cumulators
    ///         identical to the dust-free reference. Strengthens the C19-F1
    ///         fix beyond the single-trade case to a sequence-level invariant.
    function testFuzz_manyDustTradesDoNotShiftCumulators(
        uint256 priceRaw,
        uint256 dustSeed,
        uint8 dustCount
    ) public {
        uint256 price = bound(priceRaw, 1e15, 1e20);
        uint256 nDust = bound(dustCount, 1, 32);
        uint256 vol = PRECISION;

        VWAPPrecisionWrapper a = new VWAPPrecisionWrapper();
        VWAPPrecisionWrapper b = new VWAPPrecisionWrapper();
        a.initialize(price); a.grow(128);
        b.initialize(price); b.grow(128);

        // Real trade.
        vm.warp(block.timestamp + 30 seconds);
        a.recordTrade(price, vol);
        b.recordTrade(price, vol);

        // Inject N dust trades on B only at varied prices.
        for (uint256 i = 0; i < nDust; i++) {
            vm.warp(block.timestamp + 1 seconds);
            uint256 dPrice = (uint256(keccak256(abi.encode(dustSeed, i))) % 1e22) + 1e13;
            uint256 dVol = (uint256(keccak256(abi.encode(dustSeed, i, "v"))) % (PRECISION - 1)) + 1;
            b.recordTrade(dPrice, dVol);
        }

        // Real trade.
        vm.warp(block.timestamp + 30 seconds);
        a.recordTrade(price, vol);
        b.recordTrade(price, vol);

        (uint128 pcA, uint128 vcA) = a.getCurrentCumulatives();
        (uint128 pcB, uint128 vcB) = b.getCurrentCumulatives();
        assertEq(pcA, pcB, "C19-F1: dust sequence shifted priceCumulative");
        assertEq(vcA, vcB, "C19-F1: dust sequence shifted volumeCumulative");
    }

    /// @notice LAST-PRICE FALLBACK property: even when a dust trade is a no-op
    ///         on the cumulators, it MUST update lastPrice so the no-volume-
    ///         in-period fallback path returns a fresh value.
    function testFuzz_dustUpdatesLastPrice(uint256 dustPrice) public {
        dustPrice = bound(dustPrice, 1e13, 1e22);

        VWAPPrecisionWrapper oracle = new VWAPPrecisionWrapper();
        oracle.initialize(1000e18);
        oracle.grow(8);

        // Dust trade must update lastPrice to dustPrice / PRICE_SCALE * PRICE_SCALE
        // (truncated then re-scaled — last-price loses sub-PRICE_SCALE bits).
        vm.warp(block.timestamp + 1 seconds);
        oracle.recordTrade(dustPrice, 100); // dust

        uint256 lastPrice = oracle.getLastPrice();
        uint256 expected = (dustPrice / PRICE_SCALE) * PRICE_SCALE;
        assertEq(lastPrice, expected, "C19-F1: dust did not update lastPrice");
    }
}
