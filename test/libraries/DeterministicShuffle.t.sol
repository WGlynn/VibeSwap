// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/DeterministicShuffle.sol";

/// @notice Harness contract that wraps DeterministicShuffle library calls as external functions
/// so vm.expectRevert() can intercept reverts from internal library calls.
contract DeterministicShuffleHarness {
    function getShuffledIndex(uint256 totalLength, uint256 position, bytes32 seed)
        external pure returns (uint256)
    {
        return DeterministicShuffle.getShuffledIndex(totalLength, position, seed);
    }

    function partitionAndShuffle(uint256 totalOrders, uint256 priorityCount, bytes32 seed)
        external pure returns (uint256[] memory)
    {
        return DeterministicShuffle.partitionAndShuffle(totalOrders, priorityCount, seed);
    }
}

/**
 * @title DeterministicShuffleTest
 * @notice Unit tests for DeterministicShuffle — seed generation, Fisher-Yates,
 *         verification, and partition helpers.
 */
contract DeterministicShuffleTest is Test {
    bytes32 constant SEED_A = keccak256("seedA");
    bytes32 constant SEED_B = keccak256("seedB");
    DeterministicShuffleHarness harness;

    function setUp() public {
        harness = new DeterministicShuffleHarness();
    }

    // ============ generateSeed ============

    function test_generateSeed_empty() public pure {
        bytes32[] memory secrets = new bytes32[](0);
        bytes32 seed = DeterministicShuffle.generateSeed(secrets);
        // keccak256(0x00...00 ++ 0) — deterministic, non-zero
        assertNotEq(seed, bytes32(0));
    }

    function test_generateSeed_single() public pure {
        bytes32[] memory secrets = new bytes32[](1);
        secrets[0] = SEED_A;
        bytes32 seed = DeterministicShuffle.generateSeed(secrets);
        assertNotEq(seed, bytes32(0));
    }

    function test_generateSeed_xorOfTwo() public pure {
        // XOR(A, B) then keccak
        bytes32[] memory secrets = new bytes32[](2);
        secrets[0] = SEED_A;
        secrets[1] = SEED_B;
        bytes32 seed = DeterministicShuffle.generateSeed(secrets);

        // Should equal keccak256(SEED_A ^ SEED_B, 2)
        bytes32 expected = keccak256(abi.encodePacked(SEED_A ^ SEED_B, uint256(2)));
        assertEq(seed, expected);
    }

    function test_generateSeed_orderIndependent_xorProperty() public pure {
        // XOR is commutative, so AB and BA produce the same XOR intermediate
        bytes32[] memory ab = new bytes32[](2);
        ab[0] = SEED_A;
        ab[1] = SEED_B;

        bytes32[] memory ba = new bytes32[](2);
        ba[0] = SEED_B;
        ba[1] = SEED_A;

        // Both produce the same seed (XOR order doesn't matter)
        assertEq(
            DeterministicShuffle.generateSeed(ab),
            DeterministicShuffle.generateSeed(ba)
        );
    }

    function test_generateSeed_differentLengths_differentSeeds() public pure {
        bytes32[] memory one = new bytes32[](1);
        one[0] = SEED_A;

        bytes32[] memory two = new bytes32[](2);
        two[0] = SEED_A;
        two[1] = bytes32(0);

        // Even with same XOR the length suffix differentiates them
        assertNotEq(
            DeterministicShuffle.generateSeed(one),
            DeterministicShuffle.generateSeed(two)
        );
    }

    // ============ generateSeedSecure ============

    function test_generateSeedSecure_deterministicOutput() public pure {
        bytes32[] memory secrets = new bytes32[](2);
        secrets[0] = SEED_A;
        secrets[1] = SEED_B;
        bytes32 blockEntropy = keccak256("block42");
        uint64 batchId = 7;

        bytes32 s1 = DeterministicShuffle.generateSeedSecure(secrets, blockEntropy, batchId);
        bytes32 s2 = DeterministicShuffle.generateSeedSecure(secrets, blockEntropy, batchId);
        assertEq(s1, s2);
    }

    function test_generateSeedSecure_differentBatchId_differentSeed() public pure {
        bytes32[] memory secrets = new bytes32[](1);
        secrets[0] = SEED_A;
        bytes32 entropy = keccak256("entropy");

        bytes32 s1 = DeterministicShuffle.generateSeedSecure(secrets, entropy, 1);
        bytes32 s2 = DeterministicShuffle.generateSeedSecure(secrets, entropy, 2);
        assertNotEq(s1, s2);
    }

    function test_generateSeedSecure_differentEntropy_differentSeed() public pure {
        bytes32[] memory secrets = new bytes32[](1);
        secrets[0] = SEED_A;

        bytes32 s1 = DeterministicShuffle.generateSeedSecure(secrets, keccak256("e1"), 1);
        bytes32 s2 = DeterministicShuffle.generateSeedSecure(secrets, keccak256("e2"), 1);
        assertNotEq(s1, s2);
    }

    // ============ shuffle ============

    function test_shuffle_empty() public pure {
        uint256[] memory result = DeterministicShuffle.shuffle(0, SEED_A);
        assertEq(result.length, 0);
    }

    function test_shuffle_singleElement() public pure {
        uint256[] memory result = DeterministicShuffle.shuffle(1, SEED_A);
        assertEq(result.length, 1);
        assertEq(result[0], 0);
    }

    function test_shuffle_isPermutation() public pure {
        uint256 length = 10;
        uint256[] memory result = DeterministicShuffle.shuffle(length, SEED_A);
        assertEq(result.length, length);

        // Each index 0..length-1 must appear exactly once
        bool[] memory seen = new bool[](length);
        for (uint256 i = 0; i < length; i++) {
            assertLt(result[i], length, "Index out of range");
            assertFalse(seen[result[i]], "Duplicate index");
            seen[result[i]] = true;
        }
        for (uint256 i = 0; i < length; i++) {
            assertTrue(seen[i], "Missing index");
        }
    }

    function test_shuffle_differentSeedsGiveDifferentOrders() public pure {
        // With 10 elements, two random seeds should almost certainly differ
        uint256[] memory r1 = DeterministicShuffle.shuffle(10, SEED_A);
        uint256[] memory r2 = DeterministicShuffle.shuffle(10, SEED_B);

        bool anyDifferent = false;
        for (uint256 i = 0; i < 10; i++) {
            if (r1[i] != r2[i]) {
                anyDifferent = true;
                break;
            }
        }
        assertTrue(anyDifferent, "Different seeds should produce different orders");
    }

    function test_shuffle_sameSeedSameResult() public pure {
        uint256[] memory r1 = DeterministicShuffle.shuffle(8, SEED_A);
        uint256[] memory r2 = DeterministicShuffle.shuffle(8, SEED_A);
        for (uint256 i = 0; i < 8; i++) {
            assertEq(r1[i], r2[i]);
        }
    }

    function test_shuffle_twoElements_bothPossible() public pure {
        // Exhaustively verify that seed space covers both [0,1] and [1,0]
        // Try many seeds and confirm both orderings appear (statistical check)
        bool saw01 = false;
        bool saw10 = false;
        for (uint256 k = 0; k < 32; k++) {
            bytes32 s = keccak256(abi.encodePacked(k));
            uint256[] memory r = DeterministicShuffle.shuffle(2, s);
            if (r[0] == 0 && r[1] == 1) saw01 = true;
            if (r[0] == 1 && r[1] == 0) saw10 = true;
            if (saw01 && saw10) break;
        }
        assertTrue(saw01, "Should see identity ordering at some seed");
        assertTrue(saw10, "Should see swapped ordering at some seed");
    }

    function testFuzz_shuffle_isPermutation(uint8 length, bytes32 seed) public pure {
        vm.assume(length > 0 && length <= 50);
        uint256[] memory result = DeterministicShuffle.shuffle(length, seed);
        assertEq(result.length, length);

        bool[] memory seen = new bool[](length);
        for (uint256 i = 0; i < length; i++) {
            assertLt(result[i], uint256(length));
            assertFalse(seen[result[i]]);
            seen[result[i]] = true;
        }
    }

    // ============ getShuffledIndex ============

    function test_getShuffledIndex_singleElement() public pure {
        assertEq(DeterministicShuffle.getShuffledIndex(1, 0, SEED_A), 0);
    }

    function test_getShuffledIndex_matchesFullShuffle() public pure {
        uint256 length = 7;
        uint256[] memory full = DeterministicShuffle.shuffle(length, SEED_A);

        for (uint256 pos = 0; pos < length; pos++) {
            uint256 idx = DeterministicShuffle.getShuffledIndex(length, pos, SEED_A);
            assertEq(idx, full[pos]);
        }
    }

    function test_getShuffledIndex_revertsOutOfBounds() public {
        vm.expectRevert("Position out of bounds");
        harness.getShuffledIndex(5, 5, SEED_A);
    }

    // ============ verifyShuffle ============

    function test_verifyShuffle_correctResult() public pure {
        uint256 length = 8;
        uint256[] memory shuffled = DeterministicShuffle.shuffle(length, SEED_A);
        assertTrue(DeterministicShuffle.verifyShuffle(length, shuffled, SEED_A));
    }

    function test_verifyShuffle_wrongSeed() public pure {
        uint256 length = 8;
        uint256[] memory shuffled = DeterministicShuffle.shuffle(length, SEED_A);
        assertFalse(DeterministicShuffle.verifyShuffle(length, shuffled, SEED_B));
    }

    function test_verifyShuffle_wrongLength() public pure {
        uint256[] memory shuffled = DeterministicShuffle.shuffle(4, SEED_A);
        // Pass length=5 but array has 4 elements — length mismatch
        assertFalse(DeterministicShuffle.verifyShuffle(5, shuffled, SEED_A));
    }

    function test_verifyShuffle_tampered() public pure {
        uint256 length = 5;
        uint256[] memory shuffled = DeterministicShuffle.shuffle(length, SEED_A);
        // Swap two adjacent elements
        (shuffled[0], shuffled[1]) = (shuffled[1], shuffled[0]);
        assertFalse(DeterministicShuffle.verifyShuffle(length, shuffled, SEED_A));
    }

    // ============ partitionAndShuffle ============

    function test_partitionAndShuffle_noPriority() public pure {
        uint256 total = 6;
        uint256[] memory result = DeterministicShuffle.partitionAndShuffle(total, 0, SEED_A);
        assertEq(result.length, total);

        // All elements are shuffled regular orders (0..5)
        bool[] memory seen = new bool[](total);
        for (uint256 i = 0; i < total; i++) {
            assertLt(result[i], total);
            assertFalse(seen[result[i]]);
            seen[result[i]] = true;
        }
    }

    function test_partitionAndShuffle_allPriority() public pure {
        uint256 total = 4;
        uint256[] memory result = DeterministicShuffle.partitionAndShuffle(total, total, SEED_A);
        // Priority orders appear in order: [0, 1, 2, 3]
        for (uint256 i = 0; i < total; i++) {
            assertEq(result[i], i);
        }
    }

    function test_partitionAndShuffle_priorityFirst() public pure {
        uint256 total = 6;
        uint256 priority = 2;
        uint256[] memory result = DeterministicShuffle.partitionAndShuffle(total, priority, SEED_A);

        assertEq(result.length, total);
        // First `priority` slots must be 0, 1 in order
        assertEq(result[0], 0);
        assertEq(result[1], 1);

        // Remaining 4 slots must be a permutation of {2,3,4,5}
        bool[] memory seen = new bool[](total);
        for (uint256 i = priority; i < total; i++) {
            assertGe(result[i], priority, "Regular order index must be >= priority");
            assertLt(result[i], total, "Index out of range");
            assertFalse(seen[result[i]], "Duplicate index");
            seen[result[i]] = true;
        }
    }

    function test_partitionAndShuffle_revertsInvalidPriorityCount() public {
        vm.expectRevert("Invalid priority count");
        harness.partitionAndShuffle(5, 6, SEED_A);
    }

    function testFuzz_partitionAndShuffle_isPermutation(
        uint8 total,
        uint8 priority,
        bytes32 seed
    ) public pure {
        vm.assume(total > 0 && total <= 50);
        vm.assume(priority <= total);

        uint256[] memory result = DeterministicShuffle.partitionAndShuffle(total, priority, seed);
        assertEq(result.length, uint256(total));

        // Verify it's a full permutation of 0..total-1
        bool[] memory seen = new bool[](total);
        for (uint256 i = 0; i < total; i++) {
            assertLt(result[i], uint256(total));
            assertFalse(seen[result[i]]);
            seen[result[i]] = true;
        }

        // Priority indices must be in sequential order at the front
        for (uint256 i = 0; i < priority; i++) {
            assertEq(result[i], i);
        }
    }
}
