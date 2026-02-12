// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PairwiseFairness
 * @notice On-chain verification of Shapley value fairness properties
 * @dev Implements three provable fairness checks:
 *
 * 1. Pairwise Proportionality:
 *    For any two participants i, j:  φᵢ/φⱼ = wᵢ/wⱼ
 *    Verified via cross-multiplication: |φᵢ × wⱼ - φⱼ × wᵢ| ≤ ε
 *
 * 2. Time Neutrality:
 *    Identical contributions in different games yield identical rewards
 *    (when games have equal total value and coalition structure)
 *
 * 3. Efficiency:
 *    Sum of all allocations equals total distributable value
 *
 * See: docs/TIME_NEUTRAL_TOKENOMICS.md for formal proofs
 */
library PairwiseFairness {
    uint256 internal constant PRECISION = 1e18;

    // ============ Verification Results ============

    struct FairnessResult {
        bool fair;
        uint256 deviation;      // Absolute deviation from perfect fairness
        uint256 toleranceUsed;  // Tolerance threshold applied
    }

    // ============ Pairwise Proportionality ============

    /**
     * @notice Verify pairwise proportionality between two participants
     * @dev Checks: |φᵢ × wⱼ - φⱼ × wᵢ| ≤ tolerance
     *      Cross-multiplication avoids division-by-zero and minimizes rounding error
     * @param rewardA Shapley value of participant A
     * @param rewardB Shapley value of participant B
     * @param weightA Weighted contribution of participant A
     * @param weightB Weighted contribution of participant B
     * @param tolerance Maximum acceptable deviation (typically numParticipants for 1 wei/participant rounding)
     * @return result FairnessResult with fair flag and deviation amount
     */
    function verifyPairwiseProportionality(
        uint256 rewardA,
        uint256 rewardB,
        uint256 weightA,
        uint256 weightB,
        uint256 tolerance
    ) internal pure returns (FairnessResult memory result) {
        // Edge case: both zero contribution = both zero reward (trivially fair)
        if (weightA == 0 && weightB == 0) {
            return FairnessResult({fair: rewardA == 0 && rewardB == 0, deviation: 0, toleranceUsed: tolerance});
        }

        // Edge case: one zero contribution should have zero reward
        if (weightA == 0) {
            return FairnessResult({fair: rewardA == 0, deviation: rewardA, toleranceUsed: tolerance});
        }
        if (weightB == 0) {
            return FairnessResult({fair: rewardB == 0, deviation: rewardB, toleranceUsed: tolerance});
        }

        // Cross-multiplication check: rewardA * weightB ≈ rewardB * weightA
        uint256 lhs = rewardA * weightB;
        uint256 rhs = rewardB * weightA;

        uint256 deviation = lhs > rhs ? lhs - rhs : rhs - lhs;

        result = FairnessResult({
            fair: deviation <= tolerance,
            deviation: deviation,
            toleranceUsed: tolerance
        });
    }

    // ============ Time Neutrality ============

    /**
     * @notice Verify time neutrality between two allocations
     * @dev For identical contributions in games with equal total value,
     *      allocations must be equal (within rounding tolerance)
     * @param reward1 Allocation in game 1
     * @param reward2 Allocation in game 2
     * @param tolerance Maximum acceptable deviation
     * @return result FairnessResult
     */
    function verifyTimeNeutrality(
        uint256 reward1,
        uint256 reward2,
        uint256 tolerance
    ) internal pure returns (FairnessResult memory result) {
        uint256 deviation = reward1 > reward2 ? reward1 - reward2 : reward2 - reward1;

        result = FairnessResult({
            fair: deviation <= tolerance,
            deviation: deviation,
            toleranceUsed: tolerance
        });
    }

    // ============ Efficiency ============

    /**
     * @notice Verify efficiency: sum of allocations equals total value
     * @param allocations Array of all participant allocations
     * @param totalValue Total distributable value
     * @param tolerance Rounding tolerance (typically numParticipants)
     * @return result FairnessResult
     */
    function verifyEfficiency(
        uint256[] memory allocations,
        uint256 totalValue,
        uint256 tolerance
    ) internal pure returns (FairnessResult memory result) {
        uint256 sum = 0;
        for (uint256 i = 0; i < allocations.length; i++) {
            sum += allocations[i];
        }

        uint256 deviation = sum > totalValue ? sum - totalValue : totalValue - sum;

        result = FairnessResult({
            fair: deviation <= tolerance,
            deviation: deviation,
            toleranceUsed: tolerance
        });
    }

    // ============ Null Player ============

    /**
     * @notice Verify null player property: zero contribution → zero reward
     * @param reward Participant's allocation
     * @param weight Participant's weighted contribution
     * @return isNullPlayerFair True if null player property holds
     */
    function verifyNullPlayer(
        uint256 reward,
        uint256 weight
    ) internal pure returns (bool isNullPlayerFair) {
        // If weight is zero, reward must be zero
        if (weight == 0) return reward == 0;
        // If weight is non-zero, any reward is acceptable
        return true;
    }

    // ============ Full Game Verification ============

    /**
     * @notice Verify all pairwise proportionality invariants for a complete game
     * @dev O(n²) — checks every pair. Use off-chain for large games, on-chain for disputes.
     * @param rewards Array of Shapley values for all participants
     * @param weights Array of weighted contributions for all participants
     * @param tolerance Rounding tolerance
     * @return allFair True if ALL pairs satisfy proportionality
     * @return worstDeviation Largest deviation found across all pairs
     * @return worstPairA Index of first participant in worst pair
     * @return worstPairB Index of second participant in worst pair
     */
    function verifyAllPairs(
        uint256[] memory rewards,
        uint256[] memory weights,
        uint256 tolerance
    ) internal pure returns (
        bool allFair,
        uint256 worstDeviation,
        uint256 worstPairA,
        uint256 worstPairB
    ) {
        allFair = true;
        worstDeviation = 0;

        for (uint256 i = 0; i < rewards.length; i++) {
            for (uint256 j = i + 1; j < rewards.length; j++) {
                FairnessResult memory result = verifyPairwiseProportionality(
                    rewards[i], rewards[j],
                    weights[i], weights[j],
                    tolerance
                );

                if (!result.fair) {
                    allFair = false;
                }

                if (result.deviation > worstDeviation) {
                    worstDeviation = result.deviation;
                    worstPairA = i;
                    worstPairB = j;
                }
            }
        }
    }

    // ============ Contribution Normalization ============

    /**
     * @notice Calculate relative contribution as a fraction of total
     * @dev Returns value in PRECISION scale (1e18 = 100%)
     * @param contribution Individual contribution
     * @param totalContribution Sum of all contributions
     * @return Normalized contribution [0, 1e18]
     */
    function normalizeContribution(
        uint256 contribution,
        uint256 totalContribution
    ) internal pure returns (uint256) {
        if (totalContribution == 0) return 0;
        return (contribution * PRECISION) / totalContribution;
    }

    /**
     * @notice Verify that normalized contributions sum to 1.0 (PRECISION)
     * @param contributions Array of individual contributions
     * @return sumNormalized Sum of normalized values (should be ~PRECISION)
     * @return isValid True if within rounding tolerance
     */
    function verifyNormalizationIntegrity(
        uint256[] memory contributions
    ) internal pure returns (uint256 sumNormalized, bool isValid) {
        uint256 total = 0;
        for (uint256 i = 0; i < contributions.length; i++) {
            total += contributions[i];
        }

        sumNormalized = 0;
        for (uint256 i = 0; i < contributions.length; i++) {
            sumNormalized += normalizeContribution(contributions[i], total);
        }

        // Allow n wei of rounding error
        uint256 deviation = sumNormalized > PRECISION
            ? sumNormalized - PRECISION
            : PRECISION - sumNormalized;

        isValid = deviation <= contributions.length;
    }
}
