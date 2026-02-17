// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/quantum/LamportLib.sol";

// ============ Harness ============

/// @notice Exposes all internal LamportLib functions as external for testing
contract LamportLibHarness {
    function verify(
        bytes32 message,
        LamportLib.Signature memory sig,
        LamportLib.PublicKey memory pk
    ) external pure returns (bool) {
        return LamportLib.verify(message, sig, pk);
    }

    function verifyAndComputeHash(
        bytes32 message,
        LamportLib.Signature memory sig,
        bytes32[256] memory oppositeHashes
    ) external pure returns (bytes32) {
        return LamportLib.verifyAndComputeHash(message, sig, oppositeHashes);
    }

    function hashPublicKey(LamportLib.PublicKey memory pk) external pure returns (bytes32) {
        return LamportLib.hashPublicKey(pk);
    }

    function verifyWithHash(
        bytes32 message,
        LamportLib.Signature memory sig,
        bytes32 expectedPkHash,
        bytes32[256] memory oppositeHashes
    ) external pure returns (bool) {
        return LamportLib.verifyWithHash(message, sig, expectedPkHash, oppositeHashes);
    }

    function getBit(bytes32 data, uint256 index) external pure returns (uint256) {
        return LamportLib.getBit(data, index);
    }

    function hashMessage(bytes memory message) external pure returns (bytes32) {
        return LamportLib.hashMessage(message);
    }

    function hashStructuredMessage(
        bytes32 domainSeparator,
        bytes memory data
    ) external pure returns (bytes32) {
        return LamportLib.hashStructuredMessage(domainSeparator, data);
    }
}

// ============ Unit Tests ============

contract LamportLibTest is Test {
    LamportLibHarness public harness;

    // Pre-generated private key elements (deterministic for reproducibility)
    // sk[i][0] and sk[i][1] for each bit position
    bytes32[2][256] internal sk;

    function setUp() public {
        harness = new LamportLibHarness();

        // Generate deterministic private key elements
        for (uint256 i = 0; i < 256; i++) {
            sk[i][0] = keccak256(abi.encodePacked("sk", i, uint256(0)));
            sk[i][1] = keccak256(abi.encodePacked("sk", i, uint256(1)));
        }
    }

    // ============ Helper: Build Key Pair ============

    /// @dev Construct a full public key from our deterministic private key
    function _buildPublicKey() internal view returns (LamportLib.PublicKey memory pk) {
        for (uint256 i = 0; i < 256; i++) {
            // Public key = keccak256 of each private key element
            // (verify() uses keccak256(abi.encodePacked(sig.revealed[i])))
            pk.hashes[i][0] = keccak256(abi.encodePacked(sk[i][0]));
            pk.hashes[i][1] = keccak256(abi.encodePacked(sk[i][1]));
        }
    }

    /// @dev Sign a message hash using our deterministic private key
    function _sign(bytes32 messageHash) internal view returns (LamportLib.Signature memory sig) {
        for (uint256 i = 0; i < 256; i++) {
            uint256 bit = (uint256(messageHash) >> (255 - i)) & 1;
            sig.revealed[i] = sk[i][bit];
        }
    }

    /// @dev Compute the opposite hashes (the pk hashes for bits NOT revealed)
    function _oppositeHashes(bytes32 messageHash)
        internal
        view
        returns (bytes32[256] memory opposite)
    {
        LamportLib.PublicKey memory pk = _buildPublicKey();
        for (uint256 i = 0; i < 256; i++) {
            uint256 bit = (uint256(messageHash) >> (255 - i)) & 1;
            // Opposite of the revealed bit
            if (bit == 0) {
                opposite[i] = pk.hashes[i][1];
            } else {
                opposite[i] = pk.hashes[i][0];
            }
        }
    }

    // ============ getBit Tests ============

    function test_getBit_MSB_one() public view {
        // 0x80...00 has MSB = 1
        bytes32 data = bytes32(uint256(1) << 255);
        assertEq(harness.getBit(data, 0), 1, "MSB should be 1");
    }

    function test_getBit_MSB_zero() public view {
        // 0x7F...FF has MSB = 0
        bytes32 data = bytes32(type(uint256).max >> 1);
        assertEq(harness.getBit(data, 0), 0, "MSB should be 0");
    }

    function test_getBit_LSB_one() public view {
        // 0x00...01 has LSB = 1
        bytes32 data = bytes32(uint256(1));
        assertEq(harness.getBit(data, 255), 1, "LSB should be 1");
    }

    function test_getBit_LSB_zero() public view {
        // 0xFF...FE has LSB = 0
        bytes32 data = bytes32(type(uint256).max - 1);
        assertEq(harness.getBit(data, 255), 0, "LSB should be 0");
    }

    function test_getBit_middleBit() public view {
        // Set bit at position 128 (counting from MSB)
        // That is bit (255 - 128) = 127 from LSB
        bytes32 data = bytes32(uint256(1) << 127);
        assertEq(harness.getBit(data, 128), 1, "Middle bit 128 should be 1");
        assertEq(harness.getBit(data, 127), 0, "Bit 127 should be 0");
        assertEq(harness.getBit(data, 129), 0, "Bit 129 should be 0");
    }

    function test_getBit_allZeros() public view {
        bytes32 data = bytes32(0);
        for (uint256 i = 0; i < 256; i++) {
            assertEq(harness.getBit(data, i), 0, "All bits should be 0");
        }
    }

    function test_getBit_allOnes() public view {
        bytes32 data = bytes32(type(uint256).max);
        for (uint256 i = 0; i < 256; i++) {
            assertEq(harness.getBit(data, i), 1, "All bits should be 1");
        }
    }

    // ============ hashMessage Tests ============

    function test_hashMessage_knownValue() public view {
        // sha256("hello") is a well-known value
        bytes memory message = "hello";
        bytes32 result = harness.hashMessage(message);
        bytes32 expected = sha256(message);
        assertEq(result, expected, "hashMessage should return sha256 of input");
    }

    function test_hashMessage_emptyInput() public view {
        bytes memory message = "";
        bytes32 result = harness.hashMessage(message);
        bytes32 expected = sha256(message);
        assertEq(result, expected, "hashMessage of empty bytes should match sha256");
    }

    function test_hashMessage_deterministic() public view {
        bytes memory message = "VibeSwap quantum-safe";
        bytes32 result1 = harness.hashMessage(message);
        bytes32 result2 = harness.hashMessage(message);
        assertEq(result1, result2, "hashMessage should be deterministic");
    }

    // ============ hashStructuredMessage Tests ============

    function test_hashStructuredMessage_deterministic() public view {
        bytes32 domain = keccak256("VibeSwap.v1");
        bytes memory data = "transfer(100)";
        bytes32 result1 = harness.hashStructuredMessage(domain, data);
        bytes32 result2 = harness.hashStructuredMessage(domain, data);
        assertEq(result1, result2, "Structured message hash should be deterministic");
    }

    function test_hashStructuredMessage_matchesManualSha256() public view {
        bytes32 domain = keccak256("test-domain");
        bytes memory data = "some-data";
        bytes32 result = harness.hashStructuredMessage(domain, data);
        bytes32 expected = sha256(abi.encodePacked(domain, data));
        assertEq(result, expected, "Should match sha256(domainSeparator || data)");
    }

    function test_hashStructuredMessage_differentDomainsDiffer() public view {
        bytes32 domain1 = keccak256("domain-a");
        bytes32 domain2 = keccak256("domain-b");
        bytes memory data = "same-data";
        bytes32 result1 = harness.hashStructuredMessage(domain1, data);
        bytes32 result2 = harness.hashStructuredMessage(domain2, data);
        assertTrue(result1 != result2, "Different domains should produce different hashes");
    }

    // ============ hashPublicKey Tests ============

    function test_hashPublicKey_consistentForSameKey() public view {
        LamportLib.PublicKey memory pk = _buildPublicKey();
        bytes32 hash1 = harness.hashPublicKey(pk);
        bytes32 hash2 = harness.hashPublicKey(pk);
        assertEq(hash1, hash2, "Same key should produce same hash");
    }

    function test_hashPublicKey_differentKeysProduceDifferentHash() public {
        LamportLib.PublicKey memory pk1 = _buildPublicKey();

        // Build a different key by changing one element
        LamportLib.PublicKey memory pk2 = _buildPublicKey();
        pk2.hashes[0][0] = keccak256(abi.encodePacked("different-key"));

        bytes32 hash1 = harness.hashPublicKey(pk1);
        bytes32 hash2 = harness.hashPublicKey(pk2);
        assertTrue(hash1 != hash2, "Different keys should produce different hashes");
    }

    function test_hashPublicKey_nonZero() public view {
        LamportLib.PublicKey memory pk = _buildPublicKey();
        bytes32 pkHash = harness.hashPublicKey(pk);
        assertTrue(pkHash != bytes32(0), "Public key hash should not be zero");
    }

    // ============ verify Tests ============

    function test_verify_validSignature() public view {
        bytes32 messageHash = keccak256("test-message");
        LamportLib.PublicKey memory pk = _buildPublicKey();
        LamportLib.Signature memory sig = _sign(messageHash);

        bool valid = harness.verify(messageHash, sig, pk);
        assertTrue(valid, "Valid signature should verify");
    }

    function test_verify_invalidSignature_wrongRevealed() public view {
        bytes32 messageHash = keccak256("test-message");
        LamportLib.PublicKey memory pk = _buildPublicKey();
        LamportLib.Signature memory sig = _sign(messageHash);

        // Corrupt one revealed element
        sig.revealed[0] = bytes32(uint256(0xdead));

        bool valid = harness.verify(messageHash, sig, pk);
        assertFalse(valid, "Corrupted signature should not verify");
    }

    function test_verify_invalidSignature_wrongMessage() public view {
        bytes32 messageHash1 = keccak256("message-1");
        bytes32 messageHash2 = keccak256("message-2");
        LamportLib.PublicKey memory pk = _buildPublicKey();
        LamportLib.Signature memory sig = _sign(messageHash1);

        // Verify signature for message-1 against message-2 should fail
        // (unless by astronomic coincidence all differing bits happen to match)
        bool valid = harness.verify(messageHash2, sig, pk);
        assertFalse(valid, "Signature for different message should not verify");
    }

    function test_verify_allZeroMessage() public view {
        bytes32 messageHash = bytes32(0);
        LamportLib.PublicKey memory pk = _buildPublicKey();
        LamportLib.Signature memory sig = _sign(messageHash);

        bool valid = harness.verify(messageHash, sig, pk);
        assertTrue(valid, "Valid signature for all-zero message should verify");
    }

    function test_verify_allOnesMessage() public view {
        bytes32 messageHash = bytes32(type(uint256).max);
        LamportLib.PublicKey memory pk = _buildPublicKey();
        LamportLib.Signature memory sig = _sign(messageHash);

        bool valid = harness.verify(messageHash, sig, pk);
        assertTrue(valid, "Valid signature for all-ones message should verify");
    }

    function test_verify_wrongPublicKey() public view {
        bytes32 messageHash = keccak256("test-message");
        LamportLib.Signature memory sig = _sign(messageHash);

        // Create a different public key
        LamportLib.PublicKey memory wrongPk;
        for (uint256 i = 0; i < 256; i++) {
            wrongPk.hashes[i][0] = keccak256(abi.encodePacked("wrong", i, uint256(0)));
            wrongPk.hashes[i][1] = keccak256(abi.encodePacked("wrong", i, uint256(1)));
        }

        bool valid = harness.verify(messageHash, sig, wrongPk);
        assertFalse(valid, "Signature should not verify against wrong public key");
    }

    // ============ verifyAndComputeHash Tests ============

    function test_verifyAndComputeHash_matchesHashPublicKey() public view {
        bytes32 messageHash = keccak256("test-message");
        LamportLib.PublicKey memory pk = _buildPublicKey();
        LamportLib.Signature memory sig = _sign(messageHash);
        bytes32[256] memory opposite = _oppositeHashes(messageHash);

        bytes32 computedPkHash = harness.verifyAndComputeHash(messageHash, sig, opposite);
        bytes32 expectedPkHash = harness.hashPublicKey(pk);

        assertEq(computedPkHash, expectedPkHash, "Computed hash should match hashPublicKey");
    }

    function test_verifyAndComputeHash_allZeroMessage() public view {
        bytes32 messageHash = bytes32(0);
        LamportLib.PublicKey memory pk = _buildPublicKey();
        LamportLib.Signature memory sig = _sign(messageHash);
        bytes32[256] memory opposite = _oppositeHashes(messageHash);

        bytes32 computedPkHash = harness.verifyAndComputeHash(messageHash, sig, opposite);
        bytes32 expectedPkHash = harness.hashPublicKey(pk);

        assertEq(computedPkHash, expectedPkHash, "All-zero message hash should match");
    }

    function test_verifyAndComputeHash_allOnesMessage() public view {
        bytes32 messageHash = bytes32(type(uint256).max);
        LamportLib.PublicKey memory pk = _buildPublicKey();
        LamportLib.Signature memory sig = _sign(messageHash);
        bytes32[256] memory opposite = _oppositeHashes(messageHash);

        bytes32 computedPkHash = harness.verifyAndComputeHash(messageHash, sig, opposite);
        bytes32 expectedPkHash = harness.hashPublicKey(pk);

        assertEq(computedPkHash, expectedPkHash, "All-ones message hash should match");
    }

    // ============ verifyWithHash Tests ============

    function test_verifyWithHash_valid() public view {
        bytes32 messageHash = keccak256("test-message");
        LamportLib.PublicKey memory pk = _buildPublicKey();
        LamportLib.Signature memory sig = _sign(messageHash);
        bytes32[256] memory opposite = _oppositeHashes(messageHash);
        bytes32 expectedPkHash = harness.hashPublicKey(pk);

        bool valid = harness.verifyWithHash(messageHash, sig, expectedPkHash, opposite);
        assertTrue(valid, "verifyWithHash should accept valid signature");
    }

    function test_verifyWithHash_invalidHash() public view {
        bytes32 messageHash = keccak256("test-message");
        LamportLib.Signature memory sig = _sign(messageHash);
        bytes32[256] memory opposite = _oppositeHashes(messageHash);
        bytes32 wrongPkHash = keccak256("not-the-real-hash");

        bool valid = harness.verifyWithHash(messageHash, sig, wrongPkHash, opposite);
        assertFalse(valid, "verifyWithHash should reject wrong pk hash");
    }

    function test_verifyWithHash_corruptedOppositeHash() public view {
        bytes32 messageHash = keccak256("test-message");
        LamportLib.PublicKey memory pk = _buildPublicKey();
        LamportLib.Signature memory sig = _sign(messageHash);
        bytes32[256] memory opposite = _oppositeHashes(messageHash);
        bytes32 expectedPkHash = harness.hashPublicKey(pk);

        // Corrupt one opposite hash
        opposite[100] = bytes32(uint256(0xbeef));

        bool valid = harness.verifyWithHash(messageHash, sig, expectedPkHash, opposite);
        assertFalse(valid, "Corrupted opposite hash should cause verification failure");
    }

    function test_verifyWithHash_corruptedSignature() public view {
        bytes32 messageHash = keccak256("test-message");
        LamportLib.PublicKey memory pk = _buildPublicKey();
        LamportLib.Signature memory sig = _sign(messageHash);
        bytes32[256] memory opposite = _oppositeHashes(messageHash);
        bytes32 expectedPkHash = harness.hashPublicKey(pk);

        // Corrupt a revealed element in the signature
        sig.revealed[50] = bytes32(uint256(0xcafe));

        bool valid = harness.verifyWithHash(messageHash, sig, expectedPkHash, opposite);
        assertFalse(valid, "Corrupted signature should cause verification failure");
    }
}
