// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/PairwiseFairness.sol";

contract FairnessFuzzWrapper {
    function verifyPairwiseProportionality(uint256 rA, uint256 rB, uint256 wA, uint256 wB, uint256 tol)
        external pure returns (PairwiseFairness.FairnessResult memory)
    { return PairwiseFairness.verifyPairwiseProportionality(rA, rB, wA, wB, tol); }

    function verifyTimeNeutrality(uint256 r1, uint256 r2, uint256 tol)
        external pure returns (PairwiseFairness.FairnessResult memory)
    { return PairwiseFairness.verifyTimeNeutrality(r1, r2, tol); }

    function verifyEfficiency(uint256[] memory allocs, uint256 total, uint256 tol)
        external pure returns (PairwiseFairness.FairnessResult memory)
    { return PairwiseFairness.verifyEfficiency(allocs, total, tol); }

    function verifyNullPlayer(uint256 reward, uint256 weight) external pure returns (bool)
    { return PairwiseFairness.verifyNullPlayer(reward, weight); }

    function normalizeContribution(uint256 c, uint256 total) external pure returns (uint256)
    { return PairwiseFairness.normalizeContribution(c, total); }
}

contract PairwiseFairnessFuzzTest is Test {
    FairnessFuzzWrapper lib;

    function setUp() public {
        lib = new FairnessFuzzWrapper();
    }

    // ============ Fuzz: proportional rewards are always fair ============
    function testFuzz_proportional_alwaysFair(uint256 weight, uint256 multiplier) public view {
        weight = bound(weight, 1, 1e9);
        multiplier = bound(multiplier, 1, 1e9);
        // If rewards are proportional to weights, deviation = 0
        uint256 rewardA = weight * multiplier;
        uint256 rewardB = (weight * 2) * multiplier;
        PairwiseFairness.FairnessResult memory r = lib.verifyPairwiseProportionality(
            rewardA, rewardB, weight, weight * 2, 0
        );
        assertTrue(r.fair);
        assertEq(r.deviation, 0);
    }

    // ============ Fuzz: null player — zero weight must have zero reward ============
    function testFuzz_nullPlayer_zeroWeight(uint256 reward) public view {
        reward = bound(reward, 0, 1e30);
        if (reward == 0) {
            assertTrue(lib.verifyNullPlayer(reward, 0));
        } else {
            assertFalse(lib.verifyNullPlayer(reward, 0));
        }
    }

    // ============ Fuzz: null player — nonzero weight always passes ============
    function testFuzz_nullPlayer_nonzeroWeight(uint256 reward, uint256 weight) public view {
        weight = bound(weight, 1, 1e30);
        reward = bound(reward, 0, 1e30);
        assertTrue(lib.verifyNullPlayer(reward, weight));
    }

    // ============ Fuzz: time neutrality is symmetric ============
    function testFuzz_timeNeutrality_symmetric(uint256 r1, uint256 r2, uint256 tol) public view {
        r1 = bound(r1, 0, 1e30);
        r2 = bound(r2, 0, 1e30);
        tol = bound(tol, 0, 1e30);
        PairwiseFairness.FairnessResult memory res1 = lib.verifyTimeNeutrality(r1, r2, tol);
        PairwiseFairness.FairnessResult memory res2 = lib.verifyTimeNeutrality(r2, r1, tol);
        assertEq(res1.fair, res2.fair);
        assertEq(res1.deviation, res2.deviation);
    }

    // ============ Fuzz: efficiency with exact sum ============
    function testFuzz_efficiency_exactSum(uint256 a, uint256 b) public view {
        a = bound(a, 0, 1e18);
        b = bound(b, 0, 1e18);
        uint256[] memory allocs = new uint256[](2);
        allocs[0] = a;
        allocs[1] = b;
        PairwiseFairness.FairnessResult memory r = lib.verifyEfficiency(allocs, a + b, 0);
        assertTrue(r.fair);
        assertEq(r.deviation, 0);
    }

    // ============ Fuzz: normalization <= PRECISION ============
    function testFuzz_normalize_bounded(uint256 c, uint256 total) public view {
        total = bound(total, 1, 1e30);
        c = bound(c, 0, total);
        uint256 norm = lib.normalizeContribution(c, total);
        assertLe(norm, 1e18);
    }
}
