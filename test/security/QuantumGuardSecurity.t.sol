// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/quantum/QuantumGuard.sol";
import "../../contracts/quantum/LamportLib.sol";

/**
 * @title QuantumGuard Security & Verification Tests
 * @notice Extended tests covering actual cryptographic proof verification and consumption,
 *         key bitmap tracking, Merkle proof validation, and attack resistance.
 *         Complements the base QuantumGuard.t.sol which tests key management only.
 */

// ============ Concrete Implementation ============

contract SecurityConcreteQG is QuantumGuard {
    function init(uint256 threshold, string memory name) external {
        _initQuantumGuard(threshold, name);
    }

    function verifyAndConsume(
        address user,
        bytes32 messageHash,
        QuantumProof calldata proof
    ) external returns (bool) {
        return _verifyAndConsumeQuantumProof(user, messageHash, proof);
    }

    function getUsedKeyBitmap(address user) external view returns (uint256) {
        return _quantumKeys[user].usedKeyBitmap;
    }

    function getUsedCount(address user) external view returns (uint256) {
        return _quantumKeys[user].usedCount;
    }

    function getLastUsed(address user) external view returns (uint48) {
        return _quantumKeys[user].lastUsed;
    }

    function getQuantumThreshold() external view returns (uint256) {
        return _quantumThreshold;
    }

    function getQuantumDomainSeparator() external view returns (bytes32) {
        return _quantumDomainSeparator;
    }
}

// ============ Test Contract ============

contract QuantumGuardSecurityTest is Test {
    SecurityConcreteQG public guard;

    // ============ Re-declare Events ============

    event QuantumKeyRegistered(address indexed user, bytes32 merkleRoot, uint256 totalKeys, bool required);
    event QuantumAuthVerified(address indexed user, uint256 keyIndex, bytes32 messageHash);

    // ============ Actors ============

    address public alice;
    address public bob;
    address public attacker;

    // ============ Constants ============

    uint256 constant THRESHOLD = 1000 ether;
    string constant GUARD_NAME = "VibeSwapQuantumSecurity";

    // ============ Lamport Key Material ============

    bytes32[2][256] internal sk; // sk[i][0], sk[i][1] per bit

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        attacker = makeAddr("attacker");

        guard = new SecurityConcreteQG();
        guard.init(THRESHOLD, GUARD_NAME);

        // Generate deterministic private key elements
        for (uint256 i = 0; i < 256; i++) {
            sk[i][0] = keccak256(abi.encodePacked("sk", i, uint256(0)));
            sk[i][1] = keccak256(abi.encodePacked("sk", i, uint256(1)));
        }
    }

    // ============ Helpers ============

    /// @dev Build public key from deterministic private key
    function _buildPublicKey() internal view returns (LamportLib.PublicKey memory pk) {
        for (uint256 i = 0; i < 256; i++) {
            pk.hashes[i][0] = keccak256(abi.encodePacked(sk[i][0]));
            pk.hashes[i][1] = keccak256(abi.encodePacked(sk[i][1]));
        }
    }

    /// @dev Sign a message hash
    function _sign(bytes32 messageHash) internal view returns (LamportLib.Signature memory sig) {
        for (uint256 i = 0; i < 256; i++) {
            uint256 bit = (uint256(messageHash) >> (255 - i)) & 1;
            sig.revealed[i] = sk[i][bit];
        }
    }

    /// @dev Get opposite hashes (pk values for bits NOT in the signature)
    function _oppositeHashes(bytes32 messageHash)
        internal
        view
        returns (bytes32[256] memory opposite)
    {
        LamportLib.PublicKey memory pk = _buildPublicKey();
        for (uint256 i = 0; i < 256; i++) {
            uint256 bit = (uint256(messageHash) >> (255 - i)) & 1;
            opposite[i] = (bit == 0) ? pk.hashes[i][1] : pk.hashes[i][0];
        }
    }

    /// @dev Compute public key hash
    function _pkHash() internal view returns (bytes32) {
        LamportLib.PublicKey memory pk = _buildPublicKey();
        return LamportLib.hashPublicKey(pk);
    }

    /// @dev Build a single-leaf Merkle tree where the leaf IS the public key hash
    function _singleLeafRoot() internal view returns (bytes32) {
        return _pkHash();
    }

    /// @dev Build a complete quantum proof for the guard
    function _buildProof(bytes32 messageHash, uint256 keyIndex)
        internal
        view
        returns (QuantumGuard.QuantumProof memory proof)
    {
        proof.keyIndex = keyIndex;
        proof.publicKeyHash = _pkHash();
        proof.merkleProof = new bytes32[](0); // Single-leaf tree
        proof.signature = _sign(messageHash);
        proof.oppositeHashes = _oppositeHashes(messageHash);
    }

    /// @dev Register alice with a single-leaf Merkle tree
    function _registerAlice(uint256 totalKeys) internal {
        bytes32 root = _singleLeafRoot();
        vm.prank(alice);
        guard.registerQuantumKey(root, totalKeys, false);
    }

    // ====================================================================
    // ============ Proof Verification (Real Crypto) ============
    // ====================================================================

    function test_verifyProof_validProof_succeeds() public {
        _registerAlice(1);

        bytes32 messageHash = keccak256("valid-proof-test");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        bool valid = guard.verifyQuantumProof(alice, messageHash, proof);
        assertTrue(valid, "Valid proof should verify");
    }

    function test_verifyProof_wrongMessage_fails() public {
        _registerAlice(1);

        bytes32 messageHash = keccak256("message-1");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        // Verify against a different message
        bytes32 wrongMessage = keccak256("message-2");
        bool valid = guard.verifyQuantumProof(alice, wrongMessage, proof);
        assertFalse(valid, "Proof for wrong message should fail");
    }

    function test_verifyProof_corruptedSignature_fails() public {
        _registerAlice(1);

        bytes32 messageHash = keccak256("corrupt-sig");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        // Corrupt one revealed element
        proof.signature.revealed[42] = bytes32(uint256(0xdead));

        bool valid = guard.verifyQuantumProof(alice, messageHash, proof);
        assertFalse(valid, "Corrupted signature should fail");
    }

    function test_verifyProof_corruptedOppositeHash_fails() public {
        _registerAlice(1);

        bytes32 messageHash = keccak256("corrupt-opposite");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        // Corrupt an opposite hash
        proof.oppositeHashes[100] = bytes32(uint256(0xbeef));

        bool valid = guard.verifyQuantumProof(alice, messageHash, proof);
        assertFalse(valid, "Corrupted opposite hash should fail");
    }

    function test_verifyProof_wrongPublicKeyHash_fails() public {
        _registerAlice(1);

        bytes32 messageHash = keccak256("wrong-pkhash");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        // Override public key hash with wrong value
        proof.publicKeyHash = keccak256("fake-pk-hash");

        bool valid = guard.verifyQuantumProof(alice, messageHash, proof);
        // Merkle root won't match since pkHash is used as the leaf
        assertFalse(valid, "Wrong public key hash should fail Merkle check");
    }

    function test_verifyProof_wrongMerkleRoot_fails() public {
        // Register with a different root than what our keys produce
        bytes32 wrongRoot = keccak256("wrong-root");
        vm.prank(alice);
        guard.registerQuantumKey(wrongRoot, 1, false);

        bytes32 messageHash = keccak256("wrong-root-msg");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        bool valid = guard.verifyQuantumProof(alice, messageHash, proof);
        assertFalse(valid, "Wrong Merkle root should fail");
    }

    // ====================================================================
    // ============ Verify and Consume ============
    // ====================================================================

    function test_verifyAndConsume_success_updatesState() public {
        _registerAlice(4);

        bytes32 messageHash = keccak256("consume-state-test");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        vm.warp(5000);
        guard.verifyAndConsume(alice, messageHash, proof);

        // Bitmap should have bit 0 set
        assertEq(guard.getUsedKeyBitmap(alice) & 1, 1, "Bit 0 should be set");
        // Used count incremented
        assertEq(guard.getUsedCount(alice), 1);
        // lastUsed updated
        assertEq(guard.getLastUsed(alice), 5000);
        // Keys remaining decremented
        assertEq(guard.quantumKeysRemaining(alice), 3);
    }

    function test_verifyAndConsume_emitsEvent() public {
        _registerAlice(4);

        bytes32 messageHash = keccak256("emit-consume");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        vm.expectEmit(true, false, false, true);
        emit QuantumAuthVerified(alice, 0, messageHash);
        guard.verifyAndConsume(alice, messageHash, proof);
    }

    function test_verifyAndConsume_revert_invalidProof() public {
        _registerAlice(4);

        // Zero proof — all fields empty
        QuantumGuard.QuantumProof memory badProof;
        badProof.keyIndex = 0;
        badProof.publicKeyHash = bytes32(0);
        badProof.merkleProof = new bytes32[](0);

        vm.expectRevert(QuantumGuard.InvalidQuantumProof.selector);
        guard.verifyAndConsume(alice, keccak256("bad"), badProof);
    }

    function test_verifyAndConsume_revert_keyAlreadyUsed() public {
        _registerAlice(4);

        bytes32 messageHash = keccak256("used-key-revert");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        // First consumption succeeds
        guard.verifyAndConsume(alice, messageHash, proof);

        // Second attempt with same key index — bitmap check will fail in verifyQuantumProof
        // The proof passes through verifyQuantumProof first which returns false for used keys
        vm.expectRevert(QuantumGuard.InvalidQuantumProof.selector);
        guard.verifyAndConsume(alice, messageHash, proof);
    }

    // ====================================================================
    // ============ Bitmap Tracking ============
    // ====================================================================

    function test_bitmap_setsCorrectBit() public {
        _registerAlice(4);

        bytes32 messageHash = keccak256("bitmap-test");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        guard.verifyAndConsume(alice, messageHash, proof);

        uint256 bitmap = guard.getUsedKeyBitmap(alice);
        assertEq(bitmap & (1 << 0), 1 << 0, "Bit 0 should be set");
        assertEq(bitmap & (1 << 1), 0, "Bit 1 should not be set");
        assertEq(bitmap & (1 << 2), 0, "Bit 2 should not be set");
        assertEq(bitmap & (1 << 3), 0, "Bit 3 should not be set");
    }

    function test_bitmap_clearedOnRotation() public {
        _registerAlice(4);

        bytes32 messageHash = keccak256("bitmap-rotate");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        guard.verifyAndConsume(alice, messageHash, proof);
        assertTrue(guard.getUsedKeyBitmap(alice) != 0, "Bitmap should have bits set");

        // Rotate
        vm.prank(alice);
        guard.rotateQuantumKey(keccak256("new-root"), 8);

        assertEq(guard.getUsedKeyBitmap(alice), 0, "Bitmap should be cleared after rotation");
    }

    // ====================================================================
    // ============ Cross-User Isolation ============
    // ====================================================================

    function test_crossUser_proofDoesNotWork() public {
        // Register alice with her keys
        _registerAlice(4);

        // Register bob with a different root
        vm.prank(bob);
        guard.registerQuantumKey(keccak256("bob-root"), 4, false);

        // Build a valid proof for alice's keys
        bytes32 messageHash = keccak256("cross-user");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        // Should work for alice
        bool validForAlice = guard.verifyQuantumProof(alice, messageHash, proof);
        assertTrue(validForAlice);

        // Should fail for bob (different Merkle root)
        bool validForBob = guard.verifyQuantumProof(bob, messageHash, proof);
        assertFalse(validForBob);
    }

    // ====================================================================
    // ============ Edge Cases ============
    // ====================================================================

    function test_verifyProof_allZeroMessage() public {
        _registerAlice(1);

        bytes32 messageHash = bytes32(0);
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        bool valid = guard.verifyQuantumProof(alice, messageHash, proof);
        assertTrue(valid, "All-zero message should verify with correct proof");
    }

    function test_verifyProof_allOnesMessage() public {
        _registerAlice(1);

        bytes32 messageHash = bytes32(type(uint256).max);
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        bool valid = guard.verifyQuantumProof(alice, messageHash, proof);
        assertTrue(valid, "All-ones message should verify with correct proof");
    }

    function test_verifyProof_notActive_returnsFalse() public {
        // Bob never registered
        bytes32 messageHash = keccak256("inactive");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        bool valid = guard.verifyQuantumProof(bob, messageHash, proof);
        assertFalse(valid, "Inactive user should return false");
    }

    function test_verifyProof_revokedUser_returnsFalse() public {
        vm.warp(1000);
        _registerAlice(4);

        vm.warp(1000 + 8 days);
        vm.prank(alice);
        guard.revokeQuantumKey();

        bytes32 messageHash = keccak256("revoked");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);

        bool valid = guard.verifyQuantumProof(alice, messageHash, proof);
        assertFalse(valid, "Revoked user should return false");
    }

    function test_verifyProof_keyIndexOutOfBounds() public {
        _registerAlice(4);

        bytes32 messageHash = keccak256("oob-index");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);
        proof.keyIndex = 4; // totalKeys=4, so index 4 is out of bounds

        bool valid = guard.verifyQuantumProof(alice, messageHash, proof);
        assertFalse(valid, "Out-of-bounds key index should fail");
    }

    function test_verifyProof_keyIndexMaxBoundary() public {
        _registerAlice(256);

        bytes32 messageHash = keccak256("max-boundary");
        QuantumGuard.QuantumProof memory proof = _buildProof(messageHash, 0);
        proof.keyIndex = 256; // At boundary — should fail

        bool valid = guard.verifyQuantumProof(alice, messageHash, proof);
        assertFalse(valid, "Key index at totalKeys should fail");
    }

    // ====================================================================
    // ============ Fuzz Tests ============
    // ====================================================================

    function testFuzz_verifyProof_invalidMessage(bytes32 fuzzMessage) public {
        _registerAlice(1);

        // Build proof for a known message
        bytes32 knownMessage = keccak256("known-message");
        QuantumGuard.QuantumProof memory proof = _buildProof(knownMessage, 0);

        // If fuzzMessage matches knownMessage, it should verify. Otherwise, fail.
        bool valid = guard.verifyQuantumProof(alice, fuzzMessage, proof);
        if (fuzzMessage == knownMessage) {
            assertTrue(valid);
        } else {
            assertFalse(valid, "Proof for different message should fail");
        }
    }

    function testFuzz_verifyProof_arbitraryMessage(bytes32 fuzzMessage) public {
        _registerAlice(1);

        // Build a valid proof for whatever the fuzz message is
        QuantumGuard.QuantumProof memory proof = _buildProof(fuzzMessage, 0);

        bool valid = guard.verifyQuantumProof(alice, fuzzMessage, proof);
        assertTrue(valid, "Valid proof for any message should verify");
    }
}
