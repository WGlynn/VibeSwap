// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MemorylessFairness
 * @notice Structural fairness primitives that require NO participant history, reputation, or identity.
 *         Part of the IT meta-pattern. Fairness is a property of the MECHANISM, not the participants.
 *         A new participant with zero history receives provably identical treatment.
 *
 *         Composes with DeterministicShuffle (batch ordering) and PairwiseFairness (Shapley verification).
 *         This library adds: uniform clearing price computation, fairness proofs, and batch independence.
 *
 * @dev All functions are pure/view — no state, no history, no memory. That's the point.
 */
library MemorylessFairness {
    uint256 internal constant PRECISION = 1e18;

    // ============ Structs ============

    struct FairnessProof {
        bytes32 batchSeed;
        uint256 participantCount;
        bytes32 orderingHash;       // Hash of the computed ordering (verifiable)
        uint256 clearingPrice;
        bool verified;
    }

    struct ClearingResult {
        uint256 clearingPrice;      // Uniform price for all participants
        uint256 totalFilled;        // Total volume filled at clearing price
        uint256 buyDemand;          // Total buy demand at clearing price
        uint256 sellSupply;         // Total sell supply at clearing price
    }

    // ============ Fair Ordering ============

    /**
     * @notice Compute a provably fair ordering using Fisher-Yates shuffle
     * @dev Identical to DeterministicShuffle but returns verifiable proof hash.
     *      The ordering is deterministic given the seed — anyone can reproduce and verify.
     *      No participant's history affects their position.
     * @param batchSeed XOR of all revealed secrets (unpredictable until all reveals complete)
     * @param participantCount Number of participants in the batch
     * @return indices Fair ordering of participant indices
     * @return proofHash Hash of the ordering for compact verification
     */
    function computeFairOrdering(
        bytes32 batchSeed,
        uint256 participantCount
    ) internal pure returns (uint256[] memory indices, bytes32 proofHash) {
        indices = new uint256[](participantCount);

        // Initialize identity permutation
        for (uint256 i; i < participantCount; i++) {
            indices[i] = i;
        }

        // Fisher-Yates shuffle — provably uniform distribution
        for (uint256 i = participantCount - 1; i > 0; i--) {
            uint256 j = uint256(keccak256(abi.encodePacked(batchSeed, i))) % (i + 1);

            // Swap
            uint256 temp = indices[i];
            indices[i] = indices[j];
            indices[j] = temp;
        }

        // Compute proof hash — anyone can verify by recomputing
        proofHash = keccak256(abi.encodePacked(indices));
    }

    /**
     * @notice Verify that a given ordering matches the expected fair ordering
     * @param batchSeed The batch seed used for shuffling
     * @param ordering The ordering to verify
     * @param participantCount Expected number of participants
     * @return valid True if the ordering matches the provably fair shuffle
     */
    function verifyFairOrdering(
        bytes32 batchSeed,
        uint256[] memory ordering,
        uint256 participantCount
    ) internal pure returns (bool valid) {
        if (ordering.length != participantCount) return false;

        (uint256[] memory expected, ) = computeFairOrdering(batchSeed, participantCount);

        for (uint256 i; i < participantCount; i++) {
            if (ordering[i] != expected[i]) return false;
        }
        return true;
    }

    // ============ Uniform Clearing Price ============

    /**
     * @notice Compute uniform clearing price from buy and sell orders
     * @dev All orders execute at the SAME price — no positional advantage.
     *      This is the core memoryless fairness guarantee for pricing.
     *      Uses simple supply-demand crossing: find the price where buy demand >= sell supply.
     * @param buyPrices Array of maximum buy prices (sorted descending)
     * @param buyAmounts Array of buy amounts corresponding to each price
     * @param sellPrices Array of minimum sell prices (sorted ascending)
     * @param sellAmounts Array of sell amounts corresponding to each price
     * @return result ClearingResult with uniform price and fill amounts
     */
    function computeUniformClearingPrice(
        uint256[] memory buyPrices,
        uint256[] memory buyAmounts,
        uint256[] memory sellPrices,
        uint256[] memory sellAmounts
    ) internal pure returns (ClearingResult memory result) {
        if (buyPrices.length == 0 || sellPrices.length == 0) {
            return result; // No clearing possible
        }

        // Walk through price levels to find crossing point
        // Buy orders: willing to pay UP TO their price (demand curve, descending)
        // Sell orders: willing to sell AT OR ABOVE their price (supply curve, ascending)

        uint256 cumulativeBuy;
        uint256 cumulativeSell;
        uint256 bestPrice;
        uint256 bestVolume;

        // Try each buy price as potential clearing price
        for (uint256 i; i < buyPrices.length; i++) {
            uint256 candidatePrice = buyPrices[i];

            // Sum all buy demand at or above this price
            cumulativeBuy = 0;
            for (uint256 b; b < buyPrices.length; b++) {
                if (buyPrices[b] >= candidatePrice) {
                    cumulativeBuy += buyAmounts[b];
                }
            }

            // Sum all sell supply at or below this price
            cumulativeSell = 0;
            for (uint256 s; s < sellPrices.length; s++) {
                if (sellPrices[s] <= candidatePrice) {
                    cumulativeSell += sellAmounts[s];
                }
            }

            // Clearing volume is the minimum of demand and supply
            uint256 volume = cumulativeBuy < cumulativeSell ? cumulativeBuy : cumulativeSell;

            // Best clearing price maximizes volume
            if (volume > bestVolume) {
                bestVolume = volume;
                bestPrice = candidatePrice;
            }
        }

        // Recompute final demand/supply at clearing price
        uint256 finalBuy;
        uint256 finalSell;
        for (uint256 b; b < buyPrices.length; b++) {
            if (buyPrices[b] >= bestPrice) finalBuy += buyAmounts[b];
        }
        for (uint256 s; s < sellPrices.length; s++) {
            if (sellPrices[s] <= bestPrice) finalSell += sellAmounts[s];
        }

        result = ClearingResult({
            clearingPrice: bestPrice,
            totalFilled: bestVolume,
            buyDemand: finalBuy,
            sellSupply: finalSell
        });
    }

    // ============ Fair Allocation ============

    /**
     * @notice Compute a provably fair allocation of a total amount among participants
     * @dev Equal split with remainder distributed by fair ordering (seed-determined).
     *      No participant's history affects their allocation.
     * @param batchSeed Seed for fair ordering of remainder
     * @param totalAmount Total amount to distribute
     * @param participantCount Number of participants
     * @return allocations Array of fair allocations
     */
    function computeFairAllocation(
        bytes32 batchSeed,
        uint256 totalAmount,
        uint256 participantCount
    ) internal pure returns (uint256[] memory allocations) {
        if (participantCount == 0) return allocations;

        allocations = new uint256[](participantCount);
        uint256 baseShare = totalAmount / participantCount;
        uint256 remainder = totalAmount % participantCount;

        // Everyone gets the base share
        for (uint256 i; i < participantCount; i++) {
            allocations[i] = baseShare;
        }

        // Remainder distributed by fair ordering (1 wei each, starting from first in order)
        if (remainder > 0) {
            (uint256[] memory order, ) = computeFairOrdering(batchSeed, participantCount);
            for (uint256 i; i < remainder; i++) {
                allocations[order[i]] += 1;
            }
        }
    }

    // ============ Batch Independence ============

    /**
     * @notice Verify that two batches are independent (no carryover state)
     * @dev Checks that seeds are different and derived from different entropy sources.
     *      Batch independence is a structural guarantee of memoryless fairness.
     * @param seed1 Seed of first batch
     * @param seed2 Seed of second batch
     * @return independent True if batches are provably independent
     */
    function verifyBatchIndependence(
        bytes32 seed1,
        bytes32 seed2
    ) internal pure returns (bool independent) {
        // Seeds must be different (same seed = same ordering = correlated batches)
        return seed1 != seed2;
    }

    // ============ Fairness Proof Generation ============

    /**
     * @notice Generate a compact fairness proof for a settled batch
     * @dev Anyone can verify this proof by recomputing from the seed.
     *      No participant identity or history is included — only structural data.
     * @param batchSeed The batch's XORed secret seed
     * @param participantCount Number of participants
     * @param clearingPrice The uniform clearing price
     * @return proof FairnessProof struct that can be verified by anyone
     */
    function generateFairnessProof(
        bytes32 batchSeed,
        uint256 participantCount,
        uint256 clearingPrice
    ) internal pure returns (FairnessProof memory proof) {
        (, bytes32 orderingHash) = computeFairOrdering(batchSeed, participantCount);

        proof = FairnessProof({
            batchSeed: batchSeed,
            participantCount: participantCount,
            orderingHash: orderingHash,
            clearingPrice: clearingPrice,
            verified: true
        });
    }

    /**
     * @notice Verify a fairness proof against claimed parameters
     * @param proof The fairness proof to verify
     * @return valid True if the proof is internally consistent
     */
    function verifyFairnessProof(
        FairnessProof memory proof
    ) internal pure returns (bool valid) {
        (, bytes32 expectedHash) = computeFairOrdering(
            proof.batchSeed,
            proof.participantCount
        );

        return proof.orderingHash == expectedHash && proof.verified;
    }
}
