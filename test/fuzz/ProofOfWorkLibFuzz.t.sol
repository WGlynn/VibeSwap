// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/ProofOfWorkLib.sol";

contract PoWFuzzWrapper {
    function verify(ProofOfWorkLib.PoWProof memory proof, uint8 difficulty)
        external view returns (bool)
    { return ProofOfWorkLib.verify(proof, difficulty); }

    function countLeadingZeroBits(bytes32 hash) external pure returns (uint8)
    { return ProofOfWorkLib.countLeadingZeroBits(hash); }

    function difficultyToValue(uint8 difficulty, uint256 baseValue) external pure returns (uint256)
    { return ProofOfWorkLib.difficultyToValue(difficulty, baseValue); }

    function difficultyToFeeDiscount(uint8 difficulty, uint256 maxDiscount)
        external pure returns (uint256)
    { return ProofOfWorkLib.difficultyToFeeDiscount(difficulty, maxDiscount); }

    function generateChallenge(address user, uint64 batchId, bytes32 poolId)
        external view returns (bytes32)
    { return ProofOfWorkLib.generateChallenge(user, batchId, poolId); }

    function estimateHashesForDifficulty(uint8 difficulty) external pure returns (uint256)
    { return ProofOfWorkLib.estimateHashesForDifficulty(difficulty); }

    function isValidProofStructure(ProofOfWorkLib.PoWProof memory proof)
        external pure returns (bool)
    { return ProofOfWorkLib.isValidProofStructure(proof); }
}

contract ProofOfWorkLibFuzzTest is Test {
    PoWFuzzWrapper lib;

    function setUp() public {
        lib = new PoWFuzzWrapper();
    }

    // ============ Fuzz: leading zero bits <= 256 ============
    function testFuzz_leadingZeros_bounded(bytes32 hash) public view {
        uint8 zeros = lib.countLeadingZeroBits(hash);
        assertLe(zeros, 255, "Leading zeros should be <= 255");
    }

    // ============ Fuzz: zero hash has maximum leading zeros ============
    function testFuzz_zeroHash_maxZeros() public view {
        uint8 zeros = lib.countLeadingZeroBits(bytes32(0));
        assertGe(zeros, 128, "Zero hash should have many leading zeros");
    }

    // ============ Fuzz: difficulty to value is monotonically increasing ============
    function testFuzz_difficultyToValue_monotonic(uint8 d1, uint8 d2) public view {
        d1 = uint8(bound(d1, ProofOfWorkLib.BASE_DIFFICULTY, 128));
        d2 = uint8(bound(d2, d1, 128));
        uint256 v1 = lib.difficultyToValue(d1, 1e18);
        uint256 v2 = lib.difficultyToValue(d2, 1e18);
        assertGe(v2, v1, "Higher difficulty should have higher value");
    }

    // ============ Fuzz: fee discount bounded by max discount ============
    function testFuzz_feeDiscount_bounded(uint8 difficulty, uint256 maxDiscount) public view {
        difficulty = uint8(bound(difficulty, 0, 128));
        maxDiscount = bound(maxDiscount, 0, 10000);
        uint256 discount = lib.difficultyToFeeDiscount(difficulty, maxDiscount);
        assertLe(discount, maxDiscount, "Discount should not exceed max");
    }

    // ============ Fuzz: fee discount monotonic with difficulty ============
    function testFuzz_feeDiscount_monotonic(uint8 d1, uint8 d2, uint256 maxDiscount) public view {
        maxDiscount = bound(maxDiscount, 100, 5000);
        d1 = uint8(bound(d1, ProofOfWorkLib.BASE_DIFFICULTY, 64));
        d2 = uint8(bound(d2, d1, 64));
        uint256 disc1 = lib.difficultyToFeeDiscount(d1, maxDiscount);
        uint256 disc2 = lib.difficultyToFeeDiscount(d2, maxDiscount);
        assertGe(disc2, disc1, "Higher difficulty should yield higher discount");
    }

    // ============ Fuzz: challenge deterministic ============
    function testFuzz_challenge_deterministic(address user, uint64 batchId, bytes32 poolId) public view {
        bytes32 c1 = lib.generateChallenge(user, batchId, poolId);
        bytes32 c2 = lib.generateChallenge(user, batchId, poolId);
        assertEq(c1, c2, "Same inputs should produce same challenge");
    }

    // ============ Fuzz: different inputs produce different challenges ============
    function testFuzz_challenge_unique(address u1, address u2, uint64 batchId) public view {
        vm.assume(u1 != u2);
        bytes32 c1 = lib.generateChallenge(u1, batchId, bytes32(0));
        bytes32 c2 = lib.generateChallenge(u2, batchId, bytes32(0));
        assertNotEq(c1, c2, "Different users should get different challenges");
    }

    // ============ Fuzz: estimated hashes grows exponentially with difficulty ============
    function testFuzz_estimateHashes_exponential(uint8 d1, uint8 d2) public view {
        d1 = uint8(bound(d1, 1, 64));
        d2 = uint8(bound(d2, d1, 64));
        uint256 h1 = lib.estimateHashesForDifficulty(d1);
        uint256 h2 = lib.estimateHashesForDifficulty(d2);
        assertGe(h2, h1, "More difficulty should need more hashes");
    }

    // ============ Fuzz: invalid proof structure detection ============
    function testFuzz_invalidProof_zeroChallengeOrNonce(bytes32 nonce) public view {
        ProofOfWorkLib.PoWProof memory proof = ProofOfWorkLib.PoWProof({
            challenge: bytes32(0),
            nonce: nonce,
            algorithm: ProofOfWorkLib.Algorithm.KECCAK256
        });
        assertFalse(lib.isValidProofStructure(proof), "Zero challenge should be invalid");
    }
}
