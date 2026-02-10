// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LamportLib
 * @notice Library for Lamport one-time signature verification
 * @dev Quantum-resistant signature scheme based purely on hash functions
 *
 * Lamport Signature Scheme:
 * ========================
 *
 * Key Generation (off-chain):
 * - Generate 256 pairs of random 256-bit values: (sk[i][0], sk[i][1]) for i in 0..255
 * - Public key: pk[i][j] = SHA256(sk[i][j]) for all i,j
 * - Public key hash: H(pk) = keccak256(pk[0][0] || pk[0][1] || ... || pk[255][1])
 *
 * Signing (off-chain):
 * - Hash message: h = SHA256(message)
 * - For each bit i of h:
 *   - If bit i is 0: reveal sk[i][0]
 *   - If bit i is 1: reveal sk[i][1]
 * - Signature = (revealed[0], revealed[1], ..., revealed[255])
 *
 * Verification (on-chain):
 * - Hash message: h = SHA256(message)
 * - For each bit i of h:
 *   - If bit i is 0: check SHA256(sig[i]) == pk[i][0]
 *   - If bit i is 1: check SHA256(sig[i]) == pk[i][1]
 *
 * Security:
 * - Breaking requires inverting SHA256 (quantum-safe)
 * - Each key can only sign ONE message (reuse reveals full private key)
 */
library LamportLib {

    // ============ Constants ============

    /// @notice Number of bits in message hash (and thus signature elements)
    uint256 internal constant BITS = 256;

    /// @notice Size of each hash element in bytes
    uint256 internal constant HASH_SIZE = 32;

    // ============ Structs ============

    /**
     * @notice A Lamport public key (512 hash values)
     * @dev pk[i][0] and pk[i][1] are the two possible hashes for bit position i
     */
    struct PublicKey {
        bytes32[2][256] hashes; // pk[bitIndex][bitValue]
    }

    /**
     * @notice A Lamport signature (256 revealed private key elements)
     * @dev Each element corresponds to one bit of the message hash
     */
    struct Signature {
        bytes32[256] revealed;
    }

    /**
     * @notice Compact public key representation (just the hash)
     * @dev Full public key can be 16KB, so we often just store/verify the hash
     */
    struct PublicKeyHash {
        bytes32 hash;
    }

    // ============ Verification Functions ============

    /**
     * @notice Verify a Lamport signature against a full public key
     * @param message The message that was signed
     * @param sig The Lamport signature
     * @param pk The full Lamport public key
     * @return valid True if signature is valid
     */
    function verify(
        bytes32 message,
        Signature memory sig,
        PublicKey memory pk
    ) internal pure returns (bool valid) {
        // For each bit of the message
        for (uint256 i = 0; i < BITS; i++) {
            // Get bit i of message
            uint256 bit = (uint256(message) >> (255 - i)) & 1;

            // Hash the revealed private key element
            bytes32 computedHash = keccak256(abi.encodePacked(sig.revealed[i]));

            // Compare to expected public key value
            if (computedHash != pk.hashes[i][bit]) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Verify signature and compute public key hash
     * @dev More gas efficient when you don't have the full public key on-chain
     * @param message The message that was signed
     * @param sig The Lamport signature
     * @param oppositeHashes The public key hashes for the opposite bits
     * @return pkHash The computed public key hash
     */
    function verifyAndComputeHash(
        bytes32 message,
        Signature memory sig,
        bytes32[256] memory oppositeHashes
    ) internal pure returns (bytes32 pkHash) {
        bytes memory pkData = new bytes(BITS * 2 * HASH_SIZE);

        for (uint256 i = 0; i < BITS; i++) {
            uint256 bit = (uint256(message) >> (255 - i)) & 1;

            // Hash revealed value
            bytes32 computedHash = keccak256(abi.encodePacked(sig.revealed[i]));

            // Store both hashes in correct order
            bytes32 hash0;
            bytes32 hash1;

            if (bit == 0) {
                hash0 = computedHash;      // We revealed sk[i][0]
                hash1 = oppositeHashes[i]; // pk[i][1] provided
            } else {
                hash0 = oppositeHashes[i]; // pk[i][0] provided
                hash1 = computedHash;      // We revealed sk[i][1]
            }

            // Pack into pkData
            uint256 offset0 = i * 64;
            uint256 offset1 = i * 64 + 32;

            assembly {
                mstore(add(add(pkData, 32), offset0), hash0)
                mstore(add(add(pkData, 32), offset1), hash1)
            }
        }

        pkHash = keccak256(pkData);
    }

    /**
     * @notice Compute public key hash from full public key
     * @param pk The full Lamport public key
     * @return hash The keccak256 hash of the serialized public key
     */
    function hashPublicKey(PublicKey memory pk) internal pure returns (bytes32) {
        bytes memory data = new bytes(BITS * 2 * HASH_SIZE);

        for (uint256 i = 0; i < BITS; i++) {
            uint256 offset0 = i * 64;
            uint256 offset1 = i * 64 + 32;

            bytes32 h0 = pk.hashes[i][0];
            bytes32 h1 = pk.hashes[i][1];

            assembly {
                mstore(add(add(data, 32), offset0), h0)
                mstore(add(add(data, 32), offset1), h1)
            }
        }

        return keccak256(data);
    }

    /**
     * @notice Verify signature given public key hash and opposite hashes
     * @param message The signed message
     * @param sig The signature
     * @param expectedPkHash The expected public key hash
     * @param oppositeHashes Hashes for the bits NOT revealed in signature
     * @return valid True if signature produces the expected public key hash
     */
    function verifyWithHash(
        bytes32 message,
        Signature memory sig,
        bytes32 expectedPkHash,
        bytes32[256] memory oppositeHashes
    ) internal pure returns (bool valid) {
        bytes32 computedHash = verifyAndComputeHash(message, sig, oppositeHashes);
        return computedHash == expectedPkHash;
    }

    // ============ Utility Functions ============

    /**
     * @notice Extract a single bit from a bytes32
     * @param data The bytes32 value
     * @param index Bit index (0 = most significant)
     * @return bit The bit value (0 or 1)
     */
    function getBit(bytes32 data, uint256 index) internal pure returns (uint256 bit) {
        return (uint256(data) >> (255 - index)) & 1;
    }

    /**
     * @notice Compute message hash for signing
     * @param message Raw message bytes
     * @return hash SHA256 hash of the message (used as the bits to sign)
     */
    function hashMessage(bytes memory message) internal pure returns (bytes32) {
        return sha256(message);
    }

    /**
     * @notice Compute structured message hash (domain separator + data)
     * @param domainSeparator Contract-specific domain separator
     * @param data The data being authorized
     * @return hash The message hash to sign
     */
    function hashStructuredMessage(
        bytes32 domainSeparator,
        bytes memory data
    ) internal pure returns (bytes32) {
        return sha256(abi.encodePacked(domainSeparator, data));
    }
}
