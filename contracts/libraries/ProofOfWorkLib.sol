// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./SHA256Verifier.sol";

/**
 * @title ProofOfWorkLib
 * @notice Library for proof-of-work verification supporting multiple hash algorithms
 * @dev Enables users to "pay with compute" as alternative to token fees/priority
 *
 * Supported algorithms:
 * - Keccak-256: Native EVM opcode, ~30 gas, Ethereum-native
 * - SHA-256: EVM precompile, ~60 gas, Bitcoin-compatible
 *
 * Difficulty is measured in leading zero bits (0-256).
 * Higher difficulty = more computational work required.
 *
 * Example difficulties:
 * - 16 bits: ~65K hashes, ~100ms on average CPU
 * - 20 bits: ~1M hashes, ~2 seconds
 * - 24 bits: ~16M hashes, ~30 seconds
 * - 28 bits: ~268M hashes, ~8 minutes
 */
library ProofOfWorkLib {
    // ============ Enums ============

    /// @notice Supported hash algorithms for PoW
    enum Algorithm {
        KECCAK256,  // Native EVM, cheaper gas
        SHA256      // Bitcoin-compatible, precompile
    }

    // ============ Structs ============

    /// @notice Proof of work submission
    /// @param challenge Unique challenge (includes trader, batch/pool, chain)
    /// @param nonce User-generated work value
    /// @param algorithm Which hash function was used
    struct PoWProof {
        bytes32 challenge;
        bytes32 nonce;
        Algorithm algorithm;
    }

    // ============ Constants ============

    /// @notice Base difficulty for value calculations (8 bits = 256 hashes)
    uint8 public constant BASE_DIFFICULTY = 8;

    /// @notice Maximum difficulty to prevent overflow (255 for uint8, covers 256-bit hash)
    uint8 public constant MAX_DIFFICULTY = 255;

    /// @notice Base difficulty for fee discount calculations
    uint8 public constant FEE_DISCOUNT_BASE_DIFFICULTY = 12;

    /// @notice Scaling factor for fee discount (basis points per difficulty above base)
    uint256 public constant FEE_DISCOUNT_SCALE = 500; // 5% per difficulty bit

    // ============ Verification Functions ============

    /**
     * @notice Verify a proof-of-work meets the claimed difficulty
     * @param proof The PoW proof to verify
     * @param claimedDifficulty The difficulty level claimed
     * @return valid True if proof is valid and meets difficulty
     */
    function verify(
        PoWProof memory proof,
        uint8 claimedDifficulty
    ) internal view returns (bool valid) {
        // Compute hash based on algorithm
        bytes32 hash;
        if (proof.algorithm == Algorithm.KECCAK256) {
            hash = keccak256(abi.encodePacked(proof.challenge, proof.nonce));
        } else {
            hash = SHA256Verifier.sha256ChallengeNonce(proof.challenge, proof.nonce);
        }

        // Count leading zeros and verify meets difficulty
        uint8 actualDifficulty = countLeadingZeroBits(hash);
        return actualDifficulty >= claimedDifficulty;
    }

    /**
     * @notice Verify and return actual difficulty achieved
     * @param proof The PoW proof to verify
     * @return difficulty The actual difficulty achieved (leading zero bits)
     */
    function verifyAndGetDifficulty(
        PoWProof memory proof
    ) internal view returns (uint8 difficulty) {
        bytes32 hash;
        if (proof.algorithm == Algorithm.KECCAK256) {
            hash = keccak256(abi.encodePacked(proof.challenge, proof.nonce));
        } else {
            hash = SHA256Verifier.sha256ChallengeNonce(proof.challenge, proof.nonce);
        }
        return countLeadingZeroBits(hash);
    }

    // ============ Difficulty Calculation ============

    /**
     * @notice Count leading zero bits in a bytes32 hash
     * @param hash The hash to analyze
     * @return zeros Number of leading zero bits (0-256)
     */
    function countLeadingZeroBits(bytes32 hash) internal pure returns (uint8 zeros) {
        uint256 value = uint256(hash);

        // Handle zero case (all 256 bits are zero)
        if (value == 0) {
            return 255; // Max uint8 value, represents 256 leading zeros
        }

        zeros = 0;

        // Binary search for leading zeros (more gas efficient than loop)
        if (value <= 0x00000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { zeros += 32; value <<= 32; }
        if (value <= 0x0000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { zeros += 16; value <<= 16; }
        if (value <= 0x00FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { zeros += 8;  value <<= 8; }
        if (value <= 0x0FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { zeros += 4;  value <<= 4; }
        if (value <= 0x3FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { zeros += 2;  value <<= 2; }
        if (value <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF) { zeros += 1; }
    }

    // ============ Value Conversion ============

    /**
     * @notice Convert difficulty to ETH-equivalent value
     * @dev Value scales exponentially: baseValue * 2^(difficulty - BASE_DIFFICULTY)
     * @param difficulty The difficulty achieved
     * @param baseValue Base value per difficulty unit (e.g., 0.0001 ether)
     * @return value The equivalent value in wei
     */
    function difficultyToValue(
        uint8 difficulty,
        uint256 baseValue
    ) internal pure returns (uint256 value) {
        if (difficulty <= BASE_DIFFICULTY) {
            return baseValue;
        }

        // Cap difficulty to prevent overflow
        uint8 effectiveDifficulty = difficulty > 64 ? 64 : difficulty;

        // value = baseValue * 2^(difficulty - BASE_DIFFICULTY)
        uint256 multiplier = uint256(1) << (effectiveDifficulty - BASE_DIFFICULTY);
        return baseValue * multiplier;
    }

    /**
     * @notice Convert difficulty to fee discount in basis points
     * @dev Discount scales linearly above base difficulty, capped at max
     * @param difficulty The difficulty achieved
     * @param maxDiscountBps Maximum discount in basis points (e.g., 5000 = 50%)
     * @return discountBps The fee discount in basis points
     */
    function difficultyToFeeDiscount(
        uint8 difficulty,
        uint256 maxDiscountBps
    ) internal pure returns (uint256 discountBps) {
        if (difficulty <= FEE_DISCOUNT_BASE_DIFFICULTY) {
            return 0;
        }

        // Linear scaling: FEE_DISCOUNT_SCALE bps per difficulty bit above base
        uint256 bitsAboveBase = difficulty - FEE_DISCOUNT_BASE_DIFFICULTY;
        discountBps = bitsAboveBase * FEE_DISCOUNT_SCALE;

        // Cap at maximum
        if (discountBps > maxDiscountBps) {
            discountBps = maxDiscountBps;
        }
    }

    // ============ Challenge Generation ============

    /**
     * @notice Generate a unique challenge for PoW
     * @dev Challenge is unique per trader, context, chain, and contract
     * @param trader The trader's address
     * @param batchId The batch ID (0 if not applicable)
     * @param poolId The pool ID (bytes32(0) if not applicable)
     * @return challenge The unique challenge hash
     */
    function generateChallenge(
        address trader,
        uint64 batchId,
        bytes32 poolId
    ) internal view returns (bytes32 challenge) {
        return keccak256(abi.encodePacked(
            trader,
            batchId,
            poolId,
            block.chainid,
            address(this)
        ));
    }

    /**
     * @notice Generate challenge with timestamp window for expiry
     * @dev Challenge changes every windowDuration seconds
     * @param trader The trader's address
     * @param batchId The batch ID
     * @param poolId The pool ID
     * @param windowDuration Duration of each challenge window in seconds
     * @return challenge The unique challenge hash
     */
    function generateChallengeWithWindow(
        address trader,
        uint64 batchId,
        bytes32 poolId,
        uint256 windowDuration
    ) internal view returns (bytes32 challenge) {
        uint256 window = block.timestamp / windowDuration;
        return keccak256(abi.encodePacked(
            trader,
            batchId,
            poolId,
            window,
            block.chainid,
            address(this)
        ));
    }

    // ============ Utility Functions ============

    /**
     * @notice Compute unique proof hash for replay prevention
     * @param challenge The challenge value
     * @param nonce The nonce value
     * @return proofHash Unique identifier for this proof
     */
    function computeProofHash(
        bytes32 challenge,
        bytes32 nonce
    ) internal pure returns (bytes32 proofHash) {
        return keccak256(abi.encodePacked(challenge, nonce));
    }

    /**
     * @notice Estimate expected hashes for a given difficulty
     * @param difficulty The difficulty level
     * @return expectedHashes Approximate number of hash attempts needed
     */
    function estimateHashesForDifficulty(
        uint8 difficulty
    ) internal pure returns (uint256 expectedHashes) {
        if (difficulty == 0) return 1;
        if (difficulty > 64) return type(uint256).max;
        return uint256(1) << difficulty;
    }

    /**
     * @notice Check if a proof hash has valid structure (non-zero)
     * @param proof The proof to validate
     * @return valid True if proof has valid structure
     */
    function isValidProofStructure(
        PoWProof memory proof
    ) internal pure returns (bool valid) {
        return proof.challenge != bytes32(0) && proof.nonce != bytes32(0);
    }
}
