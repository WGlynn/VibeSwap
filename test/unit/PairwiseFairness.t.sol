// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/PairwiseFairness.sol";

contract FairnessWrapper {
    function verifyPairwiseProportionality(
        uint256 rA, uint256 rB, uint256 wA, uint256 wB, uint256 tol
    ) external pure returns (PairwiseFairness.FairnessResult memory) {
        return PairwiseFairness.verifyPairwiseProportionality(rA, rB, wA, wB, tol);
    }

    function verifyTimeNeutrality(uint256 r1, uint256 r2, uint256 tol)
        external pure returns (PairwiseFairness.FairnessResult memory)
    {
        return PairwiseFairness.verifyTimeNeutrality(r1, r2, tol);
    }

    function verifyEfficiency(uint256[] memory allocs, uint256 total, uint256 tol)
        external pure returns (PairwiseFairness.FairnessResult memory)
    {
        return PairwiseFairness.verifyEfficiency(allocs, total, tol);
    }

    function verifyNullPlayer(uint256 reward, uint256 weight) external pure returns (bool) {
        return PairwiseFairness.verifyNullPlayer(reward, weight);
    }

    function verifyAllPairs(uint256[] memory rewards, uint256[] memory weights, uint256 tol)
        external pure returns (bool, uint256, uint256, uint256)
    {
        return PairwiseFairness.verifyAllPairs(rewards, weights, tol);
    }

    function normalizeContribution(uint256 contrib, uint256 total) external pure returns (uint256) {
        return PairwiseFairness.normalizeContribution(contrib, total);
    }

    function verifyNormalizationIntegrity(uint256[] memory contribs)
        external pure returns (uint256, bool)
    {
        return PairwiseFairness.verifyNormalizationIntegrity(contribs);
    }
}

contract PairwiseFairnessTest is Test {
    FairnessWrapper lib;
    uint256 constant PRECISION = 1e18;

    function setUp() public {
        lib = new FairnessWrapper();
    }

    // ============ verifyPairwiseProportionality ============

    function test_pairwise_perfectlyProportional() public view {
        // Reward 100, weight 10; reward 200, weight 20 → perfectly proportional
        PairwiseFairness.FairnessResult memory r = lib.verifyPairwiseProportionality(
            100, 200, 10, 20, 0
        );
        assertTrue(r.fair);
        assertEq(r.deviation, 0);
    }

    function test_pairwise_withinTolerance() public view {
        // Slightly off: 101 vs 200, weights 10 vs 20
        // LHS = 101 * 20 = 2020, RHS = 200 * 10 = 2000, deviation = 20
        PairwiseFairness.FairnessResult memory r = lib.verifyPairwiseProportionality(
            101, 200, 10, 20, 20
        );
        assertTrue(r.fair);
        assertEq(r.deviation, 20);
    }

    function test_pairwise_exceedsTolerance() public view {
        PairwiseFairness.FairnessResult memory r = lib.verifyPairwiseProportionality(
            101, 200, 10, 20, 19
        );
        assertFalse(r.fair);
    }

    function test_pairwise_bothZeroWeight() public view {
        PairwiseFairness.FairnessResult memory r = lib.verifyPairwiseProportionality(
            0, 0, 0, 0, 0
        );
        assertTrue(r.fair);
    }

    function test_pairwise_bothZeroWeight_nonZeroReward() public view {
        PairwiseFairness.FairnessResult memory r = lib.verifyPairwiseProportionality(
            10, 0, 0, 0, 0
        );
        assertFalse(r.fair);
    }

    function test_pairwise_oneZeroWeight_zeroReward() public view {
        PairwiseFairness.FairnessResult memory r = lib.verifyPairwiseProportionality(
            0, 200, 0, 20, 0
        );
        assertTrue(r.fair);
    }

    function test_pairwise_oneZeroWeight_nonZeroReward() public view {
        PairwiseFairness.FairnessResult memory r = lib.verifyPairwiseProportionality(
            10, 200, 0, 20, 0
        );
        assertFalse(r.fair);
    }

    // ============ verifyTimeNeutrality ============

    function test_timeNeutrality_equal() public view {
        PairwiseFairness.FairnessResult memory r = lib.verifyTimeNeutrality(100, 100, 0);
        assertTrue(r.fair);
        assertEq(r.deviation, 0);
    }

    function test_timeNeutrality_withinTolerance() public view {
        PairwiseFairness.FairnessResult memory r = lib.verifyTimeNeutrality(100, 102, 5);
        assertTrue(r.fair);
    }

    function test_timeNeutrality_exceeds() public view {
        PairwiseFairness.FairnessResult memory r = lib.verifyTimeNeutrality(100, 110, 5);
        assertFalse(r.fair);
        assertEq(r.deviation, 10);
    }

    // ============ verifyEfficiency ============

    function test_efficiency_perfect() public view {
        uint256[] memory allocs = new uint256[](3);
        allocs[0] = 30;
        allocs[1] = 50;
        allocs[2] = 20;
        PairwiseFairness.FairnessResult memory r = lib.verifyEfficiency(allocs, 100, 0);
        assertTrue(r.fair);
        assertEq(r.deviation, 0);
    }

    function test_efficiency_withinTolerance() public view {
        uint256[] memory allocs = new uint256[](3);
        allocs[0] = 30;
        allocs[1] = 50;
        allocs[2] = 19; // sum = 99, total = 100
        PairwiseFairness.FairnessResult memory r = lib.verifyEfficiency(allocs, 100, 3);
        assertTrue(r.fair);
    }

    function test_efficiency_exceeds() public view {
        uint256[] memory allocs = new uint256[](2);
        allocs[0] = 40;
        allocs[1] = 50;
        PairwiseFairness.FairnessResult memory r = lib.verifyEfficiency(allocs, 100, 5);
        assertFalse(r.fair);
        assertEq(r.deviation, 10);
    }

    // ============ verifyNullPlayer ============

    function test_nullPlayer_zeroWeightZeroReward() public view {
        assertTrue(lib.verifyNullPlayer(0, 0));
    }

    function test_nullPlayer_zeroWeightNonZeroReward() public view {
        assertFalse(lib.verifyNullPlayer(10, 0));
    }

    function test_nullPlayer_nonZeroWeight() public view {
        assertTrue(lib.verifyNullPlayer(50, 10)); // Any reward OK with contribution
        assertTrue(lib.verifyNullPlayer(0, 10));  // Zero reward with contribution also OK
    }

    // ============ verifyAllPairs ============

    function test_allPairs_perfectlyFair() public view {
        uint256[] memory rewards = new uint256[](3);
        uint256[] memory weights = new uint256[](3);
        rewards[0] = 100; weights[0] = 10;
        rewards[1] = 200; weights[1] = 20;
        rewards[2] = 300; weights[2] = 30;

        (bool fair, uint256 worstDev,,) = lib.verifyAllPairs(rewards, weights, 0);
        assertTrue(fair);
        assertEq(worstDev, 0);
    }

    function test_allPairs_unfairPair() public view {
        uint256[] memory rewards = new uint256[](3);
        uint256[] memory weights = new uint256[](3);
        rewards[0] = 100; weights[0] = 10;
        rewards[1] = 250; weights[1] = 20; // Disproportionate
        rewards[2] = 300; weights[2] = 30;

        (bool fair,,,) = lib.verifyAllPairs(rewards, weights, 0);
        assertFalse(fair);
    }

    function test_allPairs_identifiesWorstPair() public view {
        uint256[] memory rewards = new uint256[](3);
        uint256[] memory weights = new uint256[](3);
        rewards[0] = 100; weights[0] = 10;
        rewards[1] = 200; weights[1] = 20;
        rewards[2] = 400; weights[2] = 30; // Worst pair: 0-2 or 1-2

        (bool fair, uint256 worstDev, uint256 pairA, uint256 pairB) =
            lib.verifyAllPairs(rewards, weights, 0);
        assertFalse(fair);
        assertGt(worstDev, 0);
        // Either pair includes index 2
        assertTrue(pairA == 2 || pairB == 2);
    }

    // ============ normalizeContribution ============

    function test_normalize_basic() public view {
        // 30 out of 100 → 0.3e18
        assertEq(lib.normalizeContribution(30, 100), 0.3e18);
    }

    function test_normalize_full() public view {
        assertEq(lib.normalizeContribution(100, 100), PRECISION);
    }

    function test_normalize_zeroTotal() public view {
        assertEq(lib.normalizeContribution(50, 0), 0);
    }

    // ============ verifyNormalizationIntegrity ============

    function test_normIntegrity_valid() public view {
        uint256[] memory contribs = new uint256[](3);
        contribs[0] = 100;
        contribs[1] = 200;
        contribs[2] = 300;

        (uint256 sum, bool valid) = lib.verifyNormalizationIntegrity(contribs);
        assertTrue(valid);
        // sum should be ~1e18 within 3 wei
        assertApproxEqAbs(sum, PRECISION, 3);
    }

    function test_normIntegrity_singleElement() public view {
        uint256[] memory contribs = new uint256[](1);
        contribs[0] = 42;

        (uint256 sum, bool valid) = lib.verifyNormalizationIntegrity(contribs);
        assertTrue(valid);
        assertEq(sum, PRECISION);
    }
}
