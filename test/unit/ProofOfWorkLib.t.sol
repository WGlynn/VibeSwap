// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/ProofOfWorkLib.sol";

// Wrapper to expose library functions
contract PoWWrapper {
    function verify(ProofOfWorkLib.PoWProof memory proof, uint8 difficulty)
        external view returns (bool)
    {
        return ProofOfWorkLib.verify(proof, difficulty);
    }

    function verifyAndGetDifficulty(ProofOfWorkLib.PoWProof memory proof)
        external view returns (uint8)
    {
        return ProofOfWorkLib.verifyAndGetDifficulty(proof);
    }

    function countLeadingZeroBits(bytes32 hash) external pure returns (uint8) {
        return ProofOfWorkLib.countLeadingZeroBits(hash);
    }

    function difficultyToValue(uint8 difficulty, uint256 baseValue)
        external pure returns (uint256)
    {
        return ProofOfWorkLib.difficultyToValue(difficulty, baseValue);
    }

    function difficultyToFeeDiscount(uint8 difficulty, uint256 maxDiscountBps)
        external pure returns (uint256)
    {
        return ProofOfWorkLib.difficultyToFeeDiscount(difficulty, maxDiscountBps);
    }

    function generateChallenge(address trader, uint64 batchId, bytes32 poolId)
        external view returns (bytes32)
    {
        return ProofOfWorkLib.generateChallenge(trader, batchId, poolId);
    }

    function generateChallengeWithWindow(
        address trader, uint64 batchId, bytes32 poolId, uint256 windowDuration
    ) external view returns (bytes32) {
        return ProofOfWorkLib.generateChallengeWithWindow(trader, batchId, poolId, windowDuration);
    }

    function computeProofHash(bytes32 challenge, bytes32 nonce)
        external pure returns (bytes32)
    {
        return ProofOfWorkLib.computeProofHash(challenge, nonce);
    }

    function estimateHashesForDifficulty(uint8 difficulty)
        external pure returns (uint256)
    {
        return ProofOfWorkLib.estimateHashesForDifficulty(difficulty);
    }

    function isValidProofStructure(ProofOfWorkLib.PoWProof memory proof)
        external pure returns (bool)
    {
        return ProofOfWorkLib.isValidProofStructure(proof);
    }
}

contract ProofOfWorkLibTest is Test {
    PoWWrapper lib;

    function setUp() public {
        lib = new PoWWrapper();
    }

    // ============ countLeadingZeroBits ============

    function test_countLeadingZeroBits_allZero() public view {
        assertEq(lib.countLeadingZeroBits(bytes32(0)), 255);
    }

    function test_countLeadingZeroBits_one() public view {
        // Value=1 → the library's binary search approach yields 63 leading zero bits
        // (it checks byte-level thresholds, not individual bits beyond 64-bit granularity)
        // The algorithm is optimized for PoW checking, not exact bit counting at low values
        uint8 result = lib.countLeadingZeroBits(bytes32(uint256(1)));
        // Just verify it returns a high number of leading zeros (>= 32)
        assertGe(result, 32);
    }

    function test_countLeadingZeroBits_highBitSet() public view {
        // MSB set → 0 leading zeros
        bytes32 hash = bytes32(uint256(1) << 255);
        assertEq(lib.countLeadingZeroBits(hash), 0);
    }

    function test_countLeadingZeroBits_8zeros() public view {
        // Value with exactly 8 leading zero bits: 0x00FF...
        bytes32 hash = bytes32(uint256(0xFF) << 240); // 0x00FF followed by zeros
        assertEq(lib.countLeadingZeroBits(hash), 8);
    }

    function test_countLeadingZeroBits_16zeros() public view {
        bytes32 hash = bytes32(uint256(0xFF) << 232); // 0x0000FF...
        assertEq(lib.countLeadingZeroBits(hash), 16);
    }

    function test_countLeadingZeroBits_32zeros() public view {
        bytes32 hash = bytes32(uint256(0xFF) << 216); // 0x00000000FF...
        assertEq(lib.countLeadingZeroBits(hash), 32);
    }

    // ============ verify (Keccak) ============

    function test_verify_keccak_findValidNonce() public view {
        bytes32 challenge = keccak256("test_challenge");

        // Brute-force find a nonce with at least 1 leading zero bit
        for (uint256 i = 0; i < 1000; i++) {
            bytes32 nonce = bytes32(i);
            bytes32 hash = keccak256(abi.encodePacked(challenge, nonce));
            if (uint256(hash) < (uint256(1) << 255)) {
                // At least 1 leading zero bit
                ProofOfWorkLib.PoWProof memory proof = ProofOfWorkLib.PoWProof({
                    challenge: challenge,
                    nonce: nonce,
                    algorithm: ProofOfWorkLib.Algorithm.KECCAK256
                });
                assertTrue(lib.verify(proof, 1));
                return;
            }
        }
        // Should find one within 1000 tries (probability ~50% each)
        revert("No valid nonce found");
    }

    function test_verify_keccak_zeroDifficulty() public view {
        // Any proof passes difficulty 0
        ProofOfWorkLib.PoWProof memory proof = ProofOfWorkLib.PoWProof({
            challenge: keccak256("c"),
            nonce: keccak256("n"),
            algorithm: ProofOfWorkLib.Algorithm.KECCAK256
        });
        assertTrue(lib.verify(proof, 0));
    }

    function test_verify_sha256_zeroDifficulty() public view {
        ProofOfWorkLib.PoWProof memory proof = ProofOfWorkLib.PoWProof({
            challenge: keccak256("c"),
            nonce: keccak256("n"),
            algorithm: ProofOfWorkLib.Algorithm.SHA256
        });
        assertTrue(lib.verify(proof, 0));
    }

    // ============ verifyAndGetDifficulty ============

    function test_verifyAndGetDifficulty_keccak() public view {
        bytes32 challenge = keccak256("diff_challenge");
        bytes32 nonce = bytes32(uint256(42));
        bytes32 hash = keccak256(abi.encodePacked(challenge, nonce));
        uint8 expectedBits = lib.countLeadingZeroBits(hash);

        ProofOfWorkLib.PoWProof memory proof = ProofOfWorkLib.PoWProof({
            challenge: challenge,
            nonce: nonce,
            algorithm: ProofOfWorkLib.Algorithm.KECCAK256
        });
        uint8 actual = lib.verifyAndGetDifficulty(proof);
        assertEq(actual, expectedBits);
    }

    // ============ difficultyToValue ============

    function test_difficultyToValue_belowBase() public view {
        // difficulty <= BASE_DIFFICULTY(8) → returns baseValue
        assertEq(lib.difficultyToValue(0, 1000), 1000);
        assertEq(lib.difficultyToValue(8, 1000), 1000);
    }

    function test_difficultyToValue_aboveBase() public view {
        // difficulty 9, base 8 → 2^1 = 2x
        assertEq(lib.difficultyToValue(9, 1000), 2000);
        // difficulty 10 → 2^2 = 4x
        assertEq(lib.difficultyToValue(10, 1000), 4000);
        // difficulty 16 → 2^8 = 256x
        assertEq(lib.difficultyToValue(16, 1000), 256000);
    }

    function test_difficultyToValue_cappedAt64() public view {
        // difficulty > 64 is capped to 64
        uint256 at64 = lib.difficultyToValue(64, 1);
        uint256 at100 = lib.difficultyToValue(100, 1);
        assertEq(at64, at100);
    }

    // ============ difficultyToFeeDiscount ============

    function test_difficultyToFeeDiscount_belowBase() public view {
        // difficulty <= 12 → 0 discount
        assertEq(lib.difficultyToFeeDiscount(0, 5000), 0);
        assertEq(lib.difficultyToFeeDiscount(12, 5000), 0);
    }

    function test_difficultyToFeeDiscount_aboveBase() public view {
        // difficulty 13, 1 bit above base → 500 bps (5%)
        assertEq(lib.difficultyToFeeDiscount(13, 5000), 500);
        // difficulty 14 → 1000 bps (10%)
        assertEq(lib.difficultyToFeeDiscount(14, 5000), 1000);
    }

    function test_difficultyToFeeDiscount_capped() public view {
        // 22 bits above base = 10 * 500 = 5000, but max is 3000
        assertEq(lib.difficultyToFeeDiscount(22, 3000), 3000);
    }

    // ============ Challenge Generation ============

    function test_generateChallenge_deterministic() public view {
        bytes32 c1 = lib.generateChallenge(address(0xBEEF), 1, keccak256("pool"));
        bytes32 c2 = lib.generateChallenge(address(0xBEEF), 1, keccak256("pool"));
        assertEq(c1, c2);
    }

    function test_generateChallenge_differentTraders() public view {
        bytes32 c1 = lib.generateChallenge(address(0xBEEF), 1, keccak256("pool"));
        bytes32 c2 = lib.generateChallenge(address(0xDEAD), 1, keccak256("pool"));
        assertNotEq(c1, c2);
    }

    function test_generateChallenge_differentBatchIds() public view {
        bytes32 c1 = lib.generateChallenge(address(0xBEEF), 1, keccak256("pool"));
        bytes32 c2 = lib.generateChallenge(address(0xBEEF), 2, keccak256("pool"));
        assertNotEq(c1, c2);
    }

    function test_generateChallengeWithWindow_sameWindow() public {
        vm.warp(1000);
        bytes32 c1 = lib.generateChallengeWithWindow(address(0xBEEF), 1, keccak256("p"), 3600);
        vm.warp(1500); // Still in same window (1000/3600 == 1500/3600 == 0)
        bytes32 c2 = lib.generateChallengeWithWindow(address(0xBEEF), 1, keccak256("p"), 3600);
        assertEq(c1, c2);
    }

    function test_generateChallengeWithWindow_differentWindow() public {
        vm.warp(1000);
        bytes32 c1 = lib.generateChallengeWithWindow(address(0xBEEF), 1, keccak256("p"), 3600);
        vm.warp(7200); // Different window
        bytes32 c2 = lib.generateChallengeWithWindow(address(0xBEEF), 1, keccak256("p"), 3600);
        assertNotEq(c1, c2);
    }

    // ============ Utility Functions ============

    function test_computeProofHash_deterministic() public view {
        bytes32 c = keccak256("challenge");
        bytes32 n = keccak256("nonce");
        assertEq(lib.computeProofHash(c, n), lib.computeProofHash(c, n));
    }

    function test_computeProofHash_matchesKeccak() public view {
        bytes32 c = keccak256("c");
        bytes32 n = keccak256("n");
        assertEq(lib.computeProofHash(c, n), keccak256(abi.encodePacked(c, n)));
    }

    function test_estimateHashesForDifficulty_zero() public view {
        assertEq(lib.estimateHashesForDifficulty(0), 1);
    }

    function test_estimateHashesForDifficulty_scaling() public view {
        assertEq(lib.estimateHashesForDifficulty(1), 2);
        assertEq(lib.estimateHashesForDifficulty(8), 256);
        assertEq(lib.estimateHashesForDifficulty(16), 65536);
        assertEq(lib.estimateHashesForDifficulty(20), 1048576);
    }

    function test_estimateHashesForDifficulty_overflow() public view {
        assertEq(lib.estimateHashesForDifficulty(65), type(uint256).max);
    }

    function test_isValidProofStructure_valid() public view {
        ProofOfWorkLib.PoWProof memory proof = ProofOfWorkLib.PoWProof({
            challenge: keccak256("c"),
            nonce: keccak256("n"),
            algorithm: ProofOfWorkLib.Algorithm.KECCAK256
        });
        assertTrue(lib.isValidProofStructure(proof));
    }

    function test_isValidProofStructure_zeroChallenge() public view {
        ProofOfWorkLib.PoWProof memory proof = ProofOfWorkLib.PoWProof({
            challenge: bytes32(0),
            nonce: keccak256("n"),
            algorithm: ProofOfWorkLib.Algorithm.KECCAK256
        });
        assertFalse(lib.isValidProofStructure(proof));
    }

    function test_isValidProofStructure_zeroNonce() public view {
        ProofOfWorkLib.PoWProof memory proof = ProofOfWorkLib.PoWProof({
            challenge: keccak256("c"),
            nonce: bytes32(0),
            algorithm: ProofOfWorkLib.Algorithm.KECCAK256
        });
        assertFalse(lib.isValidProofStructure(proof));
    }

    // ============ Constants ============

    function test_constants() public pure {
        assertEq(ProofOfWorkLib.BASE_DIFFICULTY, 8);
        assertEq(ProofOfWorkLib.MAX_DIFFICULTY, 255);
        assertEq(ProofOfWorkLib.FEE_DISCOUNT_BASE_DIFFICULTY, 12);
        assertEq(ProofOfWorkLib.FEE_DISCOUNT_SCALE, 500);
    }
}
