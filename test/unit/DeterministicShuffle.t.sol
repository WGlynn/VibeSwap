// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/DeterministicShuffle.sol";

// Wrapper to expose library functions
contract ShuffleWrapper {
    function generateSeed(bytes32[] memory secrets) external pure returns (bytes32) {
        return DeterministicShuffle.generateSeed(secrets);
    }

    function generateSeedSecure(bytes32[] memory secrets, bytes32 blockEntropy, uint64 batchId)
        external pure returns (bytes32) {
        return DeterministicShuffle.generateSeedSecure(secrets, blockEntropy, batchId);
    }

    function shuffle(uint256 length, bytes32 seed) external pure returns (uint256[] memory) {
        return DeterministicShuffle.shuffle(length, seed);
    }

    function getShuffledIndex(uint256 totalLength, uint256 position, bytes32 seed)
        external pure returns (uint256) {
        return DeterministicShuffle.getShuffledIndex(totalLength, position, seed);
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

contract DeterministicShuffleTest is Test {
    ShuffleWrapper lib;

    function setUp() public {
        lib = new ShuffleWrapper();
    }

    // ============ generateSeed ============

    function test_generateSeed_deterministicOutput() public view {
        bytes32[] memory secrets = new bytes32[](2);
        secrets[0] = keccak256("secret1");
        secrets[1] = keccak256("secret2");

        bytes32 seed1 = lib.generateSeed(secrets);
        bytes32 seed2 = lib.generateSeed(secrets);
        assertEq(seed1, seed2);
    }

    function test_generateSeed_orderMatters() public view {
        bytes32[] memory s1 = new bytes32[](2);
        s1[0] = keccak256("a");
        s1[1] = keccak256("b");

        bytes32[] memory s2 = new bytes32[](2);
        s2[0] = keccak256("b");
        s2[1] = keccak256("a");

        // XOR is commutative, but keccak with length should still give same for same set
        // Actually XOR(a,b) == XOR(b,a), and length is same, so seeds ARE equal
        bytes32 seed1 = lib.generateSeed(s1);
        bytes32 seed2 = lib.generateSeed(s2);
        assertEq(seed1, seed2); // XOR is commutative
    }

    function test_generateSeed_differentSecretsDifferentSeed() public view {
        bytes32[] memory s1 = new bytes32[](1);
        s1[0] = keccak256("secret_A");

        bytes32[] memory s2 = new bytes32[](1);
        s2[0] = keccak256("secret_B");

        assertNotEq(lib.generateSeed(s1), lib.generateSeed(s2));
    }

    function test_generateSeed_emptyArray() public view {
        bytes32[] memory empty = new bytes32[](0);
        bytes32 seed = lib.generateSeed(empty);
        // Should still produce a valid seed (keccak of zeros + 0 length)
        assertNotEq(seed, bytes32(0));
    }

    // ============ generateSeedSecure ============

    function test_generateSeedSecure_differentFromInsecure() public view {
        bytes32[] memory secrets = new bytes32[](1);
        secrets[0] = keccak256("secret");

        bytes32 insecure = lib.generateSeed(secrets);
        bytes32 secure = lib.generateSeedSecure(secrets, keccak256("blockEntropy"), 1);

        assertNotEq(insecure, secure);
    }

    function test_generateSeedSecure_entropyChangesResult() public view {
        bytes32[] memory secrets = new bytes32[](1);
        secrets[0] = keccak256("secret");

        bytes32 seed1 = lib.generateSeedSecure(secrets, keccak256("block1"), 1);
        bytes32 seed2 = lib.generateSeedSecure(secrets, keccak256("block2"), 1);

        assertNotEq(seed1, seed2);
    }

    function test_generateSeedSecure_batchIdChangesResult() public view {
        bytes32[] memory secrets = new bytes32[](1);
        secrets[0] = keccak256("secret");
        bytes32 entropy = keccak256("block");

        bytes32 seed1 = lib.generateSeedSecure(secrets, entropy, 1);
        bytes32 seed2 = lib.generateSeedSecure(secrets, entropy, 2);

        assertNotEq(seed1, seed2);
    }

    // ============ shuffle ============

    function test_shuffle_emptyArray() public view {
        uint256[] memory result = lib.shuffle(0, keccak256("seed"));
        assertEq(result.length, 0);
    }

    function test_shuffle_singleElement() public view {
        uint256[] memory result = lib.shuffle(1, keccak256("seed"));
        assertEq(result.length, 1);
        assertEq(result[0], 0);
    }

    function test_shuffle_isPermutation() public view {
        uint256 n = 10;
        uint256[] memory result = lib.shuffle(n, keccak256("seed"));
        assertEq(result.length, n);

        // Verify it's a valid permutation: each index 0..n-1 appears exactly once
        bool[] memory seen = new bool[](n);
        for (uint256 i = 0; i < n; i++) {
            assertLt(result[i], n);
            assertFalse(seen[result[i]]);
            seen[result[i]] = true;
        }
    }

    function test_shuffle_deterministic() public view {
        bytes32 seed = keccak256("deterministic");
        uint256[] memory r1 = lib.shuffle(5, seed);
        uint256[] memory r2 = lib.shuffle(5, seed);

        for (uint256 i = 0; i < 5; i++) {
            assertEq(r1[i], r2[i]);
        }
    }

    function test_shuffle_differentSeedDifferentResult() public view {
        uint256[] memory r1 = lib.shuffle(10, keccak256("seed1"));
        uint256[] memory r2 = lib.shuffle(10, keccak256("seed2"));

        // Very unlikely to be the same for n=10
        bool allSame = true;
        for (uint256 i = 0; i < 10; i++) {
            if (r1[i] != r2[i]) {
                allSame = false;
                break;
            }
        }
        assertFalse(allSame);
    }

    function test_shuffle_notIdentity() public view {
        // With high probability, shuffle of 10 elements is NOT identity
        uint256[] memory result = lib.shuffle(10, keccak256("notidentity"));
        bool isIdentity = true;
        for (uint256 i = 0; i < 10; i++) {
            if (result[i] != i) {
                isIdentity = false;
                break;
            }
        }
        assertFalse(isIdentity);
    }

    // ============ getShuffledIndex ============

    function test_getShuffledIndex_matchesShuffle() public view {
        bytes32 seed = keccak256("match");
        uint256 n = 5;
        uint256[] memory full = lib.shuffle(n, seed);

        for (uint256 i = 0; i < n; i++) {
            assertEq(lib.getShuffledIndex(n, i, seed), full[i]);
        }
    }

    function test_getShuffledIndex_singleElement() public view {
        assertEq(lib.getShuffledIndex(1, 0, keccak256("x")), 0);
    }

    function test_getShuffledIndex_revertsOutOfBounds() public {
        vm.expectRevert("Position out of bounds");
        lib.getShuffledIndex(5, 5, keccak256("x"));
    }

    // ============ verifyShuffle ============

    function test_verifyShuffle_correct() public view {
        bytes32 seed = keccak256("verify");
        uint256[] memory shuffled = lib.shuffle(5, seed);
        assertTrue(lib.verifyShuffle(5, shuffled, seed));
    }

    function test_verifyShuffle_wrongOrder() public view {
        bytes32 seed = keccak256("verify");
        uint256[] memory shuffled = lib.shuffle(5, seed);

        // Swap two elements
        (shuffled[0], shuffled[1]) = (shuffled[1], shuffled[0]);
        assertFalse(lib.verifyShuffle(5, shuffled, seed));
    }

    function test_verifyShuffle_wrongLength() public view {
        bytes32 seed = keccak256("verify");
        uint256[] memory shuffled = lib.shuffle(5, seed);
        assertFalse(lib.verifyShuffle(6, shuffled, seed)); // Length mismatch
    }

    function test_verifyShuffle_wrongSeed() public view {
        uint256[] memory shuffled = lib.shuffle(5, keccak256("seedA"));
        assertFalse(lib.verifyShuffle(5, shuffled, keccak256("seedB")));
    }

    // ============ partitionAndShuffle ============

    function test_partitionAndShuffle_priorityFirst() public view {
        uint256[] memory exec = lib.partitionAndShuffle(10, 3, keccak256("partition"));
        assertEq(exec.length, 10);

        // First 3 should be 0, 1, 2 (priority, unshuffled)
        assertEq(exec[0], 0);
        assertEq(exec[1], 1);
        assertEq(exec[2], 2);

        // Remaining should be a permutation of 3..9
        bool[] memory seen = new bool[](10);
        for (uint256 i = 3; i < 10; i++) {
            assertGe(exec[i], 3);
            assertLe(exec[i], 9);
            assertFalse(seen[exec[i]]);
            seen[exec[i]] = true;
        }
    }

    function test_partitionAndShuffle_noPriority() public view {
        uint256[] memory exec = lib.partitionAndShuffle(5, 0, keccak256("nop"));
        assertEq(exec.length, 5);

        // All should be shuffled permutation of 0..4
        bool[] memory seen = new bool[](5);
        for (uint256 i = 0; i < 5; i++) {
            assertLt(exec[i], 5);
            assertFalse(seen[exec[i]]);
            seen[exec[i]] = true;
        }
    }

    function test_partitionAndShuffle_allPriority() public view {
        uint256[] memory exec = lib.partitionAndShuffle(5, 5, keccak256("all"));
        assertEq(exec.length, 5);

        // All are priority, sequential
        for (uint256 i = 0; i < 5; i++) {
            assertEq(exec[i], i);
        }
    }

    function test_partitionAndShuffle_revertsInvalidCount() public {
        vm.expectRevert("Invalid priority count");
        lib.partitionAndShuffle(5, 6, keccak256("x"));
    }
}
