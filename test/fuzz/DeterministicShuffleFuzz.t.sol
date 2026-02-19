// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/DeterministicShuffle.sol";

contract ShuffleWrapper {
    function generateSeed(bytes32[] memory secrets) external pure returns (bytes32) {
        return DeterministicShuffle.generateSeed(secrets);
    }

    function shuffle(uint256 length, bytes32 seed) external pure returns (uint256[] memory) {
        return DeterministicShuffle.shuffle(length, seed);
    }

    function verifyShuffle(uint256 originalLength, uint256[] memory shuffledIndices, bytes32 seed)
        external pure returns (bool) {
        return DeterministicShuffle.verifyShuffle(originalLength, shuffledIndices, seed);
    }

    function partitionAndShuffle(uint256 totalOrders, uint256 priorityCount, bytes32 seed)
        external pure returns (uint256[] memory) {
        return DeterministicShuffle.partitionAndShuffle(totalOrders, priorityCount, seed);
    }
}

contract DeterministicShuffleFuzzTest is Test {
    ShuffleWrapper lib;

    function setUp() public {
        lib = new ShuffleWrapper();
    }

    // ============ Fuzz: shuffle is always a valid permutation ============

    function testFuzz_shuffle_isPermutation(uint256 length, bytes32 seed) public view {
        length = bound(length, 1, 50);

        uint256[] memory result = lib.shuffle(length, seed);
        assertEq(result.length, length);

        bool[] memory seen = new bool[](length);
        for (uint256 i = 0; i < length; i++) {
            assertLt(result[i], length);
            assertFalse(seen[result[i]]);
            seen[result[i]] = true;
        }
    }

    // ============ Fuzz: shuffle is deterministic ============

    function testFuzz_shuffle_deterministic(uint256 length, bytes32 seed) public view {
        length = bound(length, 1, 30);

        uint256[] memory r1 = lib.shuffle(length, seed);
        uint256[] memory r2 = lib.shuffle(length, seed);

        for (uint256 i = 0; i < length; i++) {
            assertEq(r1[i], r2[i]);
        }
    }

    // ============ Fuzz: verifyShuffle always passes for correct shuffle ============

    function testFuzz_verifyShuffle_correct(uint256 length, bytes32 seed) public view {
        length = bound(length, 1, 30);

        uint256[] memory result = lib.shuffle(length, seed);
        assertTrue(lib.verifyShuffle(length, result, seed));
    }

    // ============ Fuzz: different seeds produce different shuffles ============

    function testFuzz_shuffle_seedSensitivity(bytes32 seed1, bytes32 seed2) public view {
        vm.assume(seed1 != seed2);
        uint256 n = 10;

        uint256[] memory r1 = lib.shuffle(n, seed1);
        uint256[] memory r2 = lib.shuffle(n, seed2);

        // At least one position should differ (extremely high probability)
        bool anyDiff = false;
        for (uint256 i = 0; i < n; i++) {
            if (r1[i] != r2[i]) {
                anyDiff = true;
                break;
            }
        }
        assertTrue(anyDiff);
    }

    // ============ Fuzz: partitionAndShuffle preserves priority ordering ============

    function testFuzz_partitionAndShuffle_priorityFirst(uint256 total, uint256 priority, bytes32 seed) public view {
        total = bound(total, 1, 30);
        priority = bound(priority, 0, total);

        uint256[] memory exec = lib.partitionAndShuffle(total, priority, seed);
        assertEq(exec.length, total);

        // Priority indices should be sequential 0..priority-1
        for (uint256 i = 0; i < priority; i++) {
            assertEq(exec[i], i);
        }

        // Regular indices should be a permutation of priority..total-1
        if (priority < total) {
            bool[] memory seen = new bool[](total);
            for (uint256 i = priority; i < total; i++) {
                assertGe(exec[i], priority);
                assertLt(exec[i], total);
                assertFalse(seen[exec[i]]);
                seen[exec[i]] = true;
            }
        }
    }

    // ============ Fuzz: generateSeed XOR commutativity ============

    function testFuzz_generateSeed_orderInvariant(bytes32 a, bytes32 b) public view {
        bytes32[] memory s1 = new bytes32[](2);
        s1[0] = a;
        s1[1] = b;

        bytes32[] memory s2 = new bytes32[](2);
        s2[0] = b;
        s2[1] = a;

        // XOR is commutative, so same seed regardless of order
        assertEq(lib.generateSeed(s1), lib.generateSeed(s2));
    }
}
