// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title DeterministicShuffle
 * @notice Implements Fisher-Yates shuffle with deterministic seed for fair order execution
 * @dev Uses XOR of revealed secrets as entropy source for MEV resistance
 */
library DeterministicShuffle {
    /**
     * @notice Generate shuffle seed from array of secrets
     * @param secrets Array of revealed order secrets
     * @return seed Combined seed for shuffle
     */
    function generateSeed(bytes32[] memory secrets) internal pure returns (bytes32 seed) {
        seed = bytes32(0);
        for (uint256 i = 0; i < secrets.length; i++) {
            seed = seed ^ secrets[i];
        }
        // Add length to prevent empty array issues
        seed = keccak256(abi.encodePacked(seed, secrets.length));
    }

    /**
     * @notice Shuffle an array of indices using Fisher-Yates algorithm
     * @param length Number of elements to shuffle
     * @param seed Random seed for deterministic shuffle
     * @return shuffled Array of shuffled indices
     */
    function shuffle(
        uint256 length,
        bytes32 seed
    ) internal pure returns (uint256[] memory shuffled) {
        if (length == 0) {
            return new uint256[](0);
        }

        shuffled = new uint256[](length);

        // Initialize with sequential indices
        for (uint256 i = 0; i < length; i++) {
            shuffled[i] = i;
        }

        // Fisher-Yates shuffle
        bytes32 currentSeed = seed;
        for (uint256 i = length - 1; i > 0; i--) {
            // Generate random index in range [0, i]
            currentSeed = keccak256(abi.encodePacked(currentSeed, i));
            uint256 j = uint256(currentSeed) % (i + 1);

            // Swap elements
            (shuffled[i], shuffled[j]) = (shuffled[j], shuffled[i]);
        }
    }

    /**
     * @notice Get shuffled order for a specific position
     * @dev More gas efficient for partial shuffles
     * @param totalLength Total number of elements
     * @param position Position to get shuffled index for
     * @param seed Random seed
     * @return The original index that should be at this position
     */
    function getShuffledIndex(
        uint256 totalLength,
        uint256 position,
        bytes32 seed
    ) internal pure returns (uint256) {
        require(position < totalLength, "Position out of bounds");

        // For single element, return 0
        if (totalLength == 1) {
            return 0;
        }

        // Full shuffle is more efficient for getting all indices
        uint256[] memory shuffled = shuffle(totalLength, seed);
        return shuffled[position];
    }

    /**
     * @notice Verify a shuffle is correctly computed
     * @param originalLength Original array length
     * @param shuffledIndices Claimed shuffled indices
     * @param seed Seed used for shuffle
     * @return valid Whether shuffle is correctly computed
     */
    function verifyShuffle(
        uint256 originalLength,
        uint256[] memory shuffledIndices,
        bytes32 seed
    ) internal pure returns (bool valid) {
        if (shuffledIndices.length != originalLength) {
            return false;
        }

        uint256[] memory expected = shuffle(originalLength, seed);

        for (uint256 i = 0; i < originalLength; i++) {
            if (shuffledIndices[i] != expected[i]) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Partition array into priority and regular orders, then shuffle regular
     * @param totalOrders Total number of orders
     * @param priorityCount Number of priority orders (at the start)
     * @param seed Random seed for shuffling regular orders
     * @return execution Array of indices in execution order
     */
    function partitionAndShuffle(
        uint256 totalOrders,
        uint256 priorityCount,
        bytes32 seed
    ) internal pure returns (uint256[] memory execution) {
        require(priorityCount <= totalOrders, "Invalid priority count");

        execution = new uint256[](totalOrders);

        // Priority orders come first (indices 0 to priorityCount-1)
        for (uint256 i = 0; i < priorityCount; i++) {
            execution[i] = i;
        }

        // Shuffle remaining regular orders
        uint256 regularCount = totalOrders - priorityCount;
        if (regularCount > 0) {
            uint256[] memory regularShuffled = shuffle(regularCount, seed);

            for (uint256 i = 0; i < regularCount; i++) {
                // Map shuffled index back to original index space
                execution[priorityCount + i] = priorityCount + regularShuffled[i];
            }
        }
    }
}
