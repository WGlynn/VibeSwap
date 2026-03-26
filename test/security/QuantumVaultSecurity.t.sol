// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/quantum/QuantumVault.sol";

/**
 * @title QuantumVault Security & Verification Tests
 * @notice Extended tests covering signature verification, key consumption/exhaustion,
 *         upgrade authorization, reentrancy guards, and edge cases not in the base suite.
 */
contract QuantumVaultSecurityTest is Test {

    // ============ State ============

    QuantumVault public vault;
    address public owner;
    address public user1;
    address public user2;
    address public attacker;

    // ============ Re-declare Events ============

    event QuantumKeyRegistered(address indexed user, bytes32 merkleRoot, uint256 totalKeys);
    event QuantumKeyRevoked(address indexed user);
    event QuantumAuthSuccess(address indexed user, uint256 keyIndex, bytes32 messageHash);
    event QuantumKeyExhausted(address indexed user);
    event ProtectedContractSet(address indexed contract_, bool protected);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ============ Setup ============

    function setUp() public {
        owner = address(this);
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        attacker = makeAddr("attacker");

        QuantumVault impl = new QuantumVault();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(QuantumVault.initialize.selector, 1 ether)
        );
        vault = QuantumVault(address(proxy));
    }

    // ============ Helpers ============

    /// @dev Build a deterministic Lamport keypair compatible with QuantumVault's
    ///      _reconstructPublicKeyHash logic. The vault checks:
    ///      pubKeyChunks[i*2] = keccak256(abi.encodePacked(signature.revealed[i]))
    ///      pubKeyChunks[i*2+1] = bytes32(uint256(signature.indices[i]))
    ///      Then: publicKeyHash = keccak256(abi.encodePacked(pubKeyChunks))
    function _buildLamportSig(bytes32 messageHash, bytes32 seed)
        internal
        pure
        returns (
            QuantumVault.LamportSignature memory sig,
            bytes32 publicKeyHash
        )
    {
        bytes32[] memory pubKeyChunks = new bytes32[](64); // CHUNKS * 2 = 32 * 2

        for (uint256 i = 0; i < 32; i++) {
            // Private key element
            sig.revealed[i] = keccak256(abi.encodePacked(seed, "sk", i));
            // Index is derived from message byte
            sig.indices[i] = uint8(messageHash[i]);

            // Public key reconstruction (matches _reconstructPublicKeyHash)
            pubKeyChunks[i * 2] = keccak256(abi.encodePacked(sig.revealed[i]));
            pubKeyChunks[i * 2 + 1] = bytes32(uint256(sig.indices[i]));
        }

        publicKeyHash = keccak256(abi.encodePacked(pubKeyChunks));
    }

    /// @dev Build a single-leaf Merkle tree for the given publicKeyHash
    function _buildSingleLeafMerkle(bytes32 publicKeyHash)
        internal
        pure
        returns (bytes32 root, bytes32[] memory proof)
    {
        root = publicKeyHash; // Single leaf = root
        proof = new bytes32[](0);
    }

    /// @dev Register a key for user with a proper Merkle root
    function _registerWithValidKey(address user, bytes32 seed)
        internal
        returns (bytes32 messageHash, QuantumVault.LamportSignature memory sig, bytes32 publicKeyHash, bytes32[] memory merkleProof)
    {
        messageHash = keccak256("test-message");
        (sig, publicKeyHash) = _buildLamportSig(messageHash, seed);
        bytes32 merkleRoot;
        (merkleRoot, merkleProof) = _buildSingleLeafMerkle(publicKeyHash);

        vm.prank(user);
        vault.registerQuantumKey(merkleRoot, 4); // 4 keys, power of 2
    }

    // ====================================================================
    // ============ Signature Verification ============
    // ====================================================================

    function test_verifySignature_validSignature() public {
        bytes32 messageHash = keccak256("verify-test");
        bytes32 seed = bytes32("seed1");
        (QuantumVault.LamportSignature memory sig, bytes32 publicKeyHash) = _buildLamportSig(messageHash, seed);
        (bytes32 merkleRoot, bytes32[] memory merkleProof) = _buildSingleLeafMerkle(publicKeyHash);

        vm.prank(user1);
        vault.registerQuantumKey(merkleRoot, 4);

        bool valid = vault.verifyQuantumSignature(
            user1, messageHash, 0, publicKeyHash, merkleProof, sig
        );
        assertTrue(valid, "Valid signature should verify");
    }

    function test_verifySignature_revert_inactiveKey() public {
        vm.expectRevert(QuantumVault.QuantumKeyInactive.selector);
        bytes32[] memory proof = new bytes32[](0);
        QuantumVault.LamportSignature memory sig;
        vault.verifyQuantumSignature(user1, keccak256("msg"), 0, bytes32(0), proof, sig);
    }

    function test_verifySignature_revert_keyAlreadyUsed() public {
        bytes32 messageHash = keccak256("used-key-test");
        bytes32 seed = bytes32("used-seed");
        (QuantumVault.LamportSignature memory sig, bytes32 publicKeyHash) = _buildLamportSig(messageHash, seed);
        (bytes32 merkleRoot, bytes32[] memory merkleProof) = _buildSingleLeafMerkle(publicKeyHash);

        vm.prank(user1);
        vault.registerQuantumKey(merkleRoot, 4);

        // First: consume the key
        vault.verifyAndConsumeQuantumSignature(
            user1, messageHash, 0, publicKeyHash, merkleProof, sig
        );

        // Second: try to verify the same key index again
        vm.expectRevert(QuantumVault.KeyAlreadyUsed.selector);
        vault.verifyQuantumSignature(
            user1, messageHash, 0, publicKeyHash, merkleProof, sig
        );
    }

    function test_verifySignature_revert_invalidMerkleProof() public {
        bytes32 messageHash = keccak256("bad-merkle");
        bytes32 seed = bytes32("merkle-seed");
        (QuantumVault.LamportSignature memory sig, bytes32 publicKeyHash) = _buildLamportSig(messageHash, seed);

        // Register with a DIFFERENT merkle root
        bytes32 wrongRoot = keccak256("wrong-root");
        vm.prank(user1);
        vault.registerQuantumKey(wrongRoot, 4);

        bytes32[] memory proof = new bytes32[](0);

        vm.expectRevert(QuantumVault.InvalidMerkleProof.selector);
        vault.verifyQuantumSignature(
            user1, messageHash, 0, publicKeyHash, proof, sig
        );
    }

    function test_verifySignature_revert_invalidSignature() public {
        bytes32 messageHash = keccak256("bad-sig-test");
        bytes32 seed = bytes32("sig-seed");
        (QuantumVault.LamportSignature memory sig, bytes32 publicKeyHash) = _buildLamportSig(messageHash, seed);
        (bytes32 merkleRoot, bytes32[] memory merkleProof) = _buildSingleLeafMerkle(publicKeyHash);

        vm.prank(user1);
        vault.registerQuantumKey(merkleRoot, 4);

        // Corrupt the signature
        sig.revealed[0] = bytes32(uint256(0xdead));

        vm.expectRevert(QuantumVault.InvalidSignature.selector);
        vault.verifyQuantumSignature(
            user1, messageHash, 0, publicKeyHash, merkleProof, sig
        );
    }

    function test_verifySignature_differentMessagesProduceDifferentHashes() public {
        bytes32 msg1 = keccak256("message-1");
        bytes32 msg2 = keccak256("message-2");
        bytes32 seed = bytes32("diff-msg");

        (, bytes32 pkHash1) = _buildLamportSig(msg1, seed);
        (, bytes32 pkHash2) = _buildLamportSig(msg2, seed);

        // Same seed but different messages should produce different public key hashes
        // because the indices are derived from the message bytes
        assertTrue(pkHash1 != pkHash2, "Different messages should produce different pk hashes");
    }

    // ====================================================================
    // ============ Verify and Consume ============
    // ====================================================================

    function test_verifyAndConsume_success() public {
        bytes32 messageHash = keccak256("consume-test");
        bytes32 seed = bytes32("consume-seed");
        (QuantumVault.LamportSignature memory sig, bytes32 publicKeyHash) = _buildLamportSig(messageHash, seed);
        (bytes32 merkleRoot, bytes32[] memory merkleProof) = _buildSingleLeafMerkle(publicKeyHash);

        vm.prank(user1);
        vault.registerQuantumKey(merkleRoot, 4);

        bool valid = vault.verifyAndConsumeQuantumSignature(
            user1, messageHash, 0, publicKeyHash, merkleProof, sig
        );
        assertTrue(valid);

        // Key should now be marked as used
        assertTrue(vault.usedKeys(keccak256(abi.encodePacked(user1, uint256(0)))));

        // Used keys count should be incremented
        (, , uint256 usedKeys, , ) = vault.quantumKeys(user1);
        assertEq(usedKeys, 1);
    }

    function test_verifyAndConsume_emitsAuthSuccessEvent() public {
        bytes32 messageHash = keccak256("event-test");
        bytes32 seed = bytes32("event-seed");
        (QuantumVault.LamportSignature memory sig, bytes32 publicKeyHash) = _buildLamportSig(messageHash, seed);
        (bytes32 merkleRoot, bytes32[] memory merkleProof) = _buildSingleLeafMerkle(publicKeyHash);

        vm.prank(user1);
        vault.registerQuantumKey(merkleRoot, 4);

        vm.expectEmit(true, false, false, true);
        emit QuantumAuthSuccess(user1, 0, messageHash);
        vault.verifyAndConsumeQuantumSignature(
            user1, messageHash, 0, publicKeyHash, merkleProof, sig
        );
    }

    function test_verifyAndConsume_doubleSpendPrevented() public {
        bytes32 messageHash = keccak256("double-spend");
        bytes32 seed = bytes32("ds-seed");
        (QuantumVault.LamportSignature memory sig, bytes32 publicKeyHash) = _buildLamportSig(messageHash, seed);
        (bytes32 merkleRoot, bytes32[] memory merkleProof) = _buildSingleLeafMerkle(publicKeyHash);

        vm.prank(user1);
        vault.registerQuantumKey(merkleRoot, 4);

        vault.verifyAndConsumeQuantumSignature(
            user1, messageHash, 0, publicKeyHash, merkleProof, sig
        );

        // Second attempt should revert
        vm.expectRevert(QuantumVault.KeyAlreadyUsed.selector);
        vault.verifyAndConsumeQuantumSignature(
            user1, messageHash, 0, publicKeyHash, merkleProof, sig
        );
    }

    // ====================================================================
    // ============ Key Exhaustion ============
    // ====================================================================

    function test_keyExhaustion_emitsExhaustedEvent() public {
        // Register with only 1 key
        bytes32 messageHash = keccak256("exhaust-test");
        bytes32 seed = bytes32("exhaust");
        (QuantumVault.LamportSignature memory sig, bytes32 publicKeyHash) = _buildLamportSig(messageHash, seed);
        (bytes32 merkleRoot, bytes32[] memory merkleProof) = _buildSingleLeafMerkle(publicKeyHash);

        vm.prank(user1);
        vault.registerQuantumKey(merkleRoot, 1);

        vm.expectEmit(true, false, false, false);
        emit QuantumKeyExhausted(user1);
        vault.verifyAndConsumeQuantumSignature(
            user1, messageHash, 0, publicKeyHash, merkleProof, sig
        );
    }

    function test_keyExhaustion_allKeysUsed_revert() public {
        bytes32 messageHash = keccak256("exhaust-revert");
        bytes32 seed = bytes32("exhaust-r");
        (QuantumVault.LamportSignature memory sig, bytes32 publicKeyHash) = _buildLamportSig(messageHash, seed);
        (bytes32 merkleRoot, bytes32[] memory merkleProof) = _buildSingleLeafMerkle(publicKeyHash);

        vm.prank(user1);
        vault.registerQuantumKey(merkleRoot, 1);

        // Consume the only key
        vault.verifyAndConsumeQuantumSignature(
            user1, messageHash, 0, publicKeyHash, merkleProof, sig
        );

        // Now try to use key index 0 again — usedKeys >= totalKeys
        vm.expectRevert(QuantumVault.AllKeysExhausted.selector);
        vault.verifyQuantumSignature(
            user1, keccak256("another-msg"), 0, publicKeyHash, merkleProof, sig
        );
    }

    function test_remainingKeys_decrementsAfterConsumption() public {
        bytes32 messageHash = keccak256("remaining-test");
        bytes32 seed = bytes32("remain");
        (QuantumVault.LamportSignature memory sig, bytes32 publicKeyHash) = _buildLamportSig(messageHash, seed);
        (bytes32 merkleRoot, bytes32[] memory merkleProof) = _buildSingleLeafMerkle(publicKeyHash);

        vm.prank(user1);
        vault.registerQuantumKey(merkleRoot, 4);

        assertEq(vault.remainingKeys(user1), 4);

        vault.verifyAndConsumeQuantumSignature(
            user1, messageHash, 0, publicKeyHash, merkleProof, sig
        );

        assertEq(vault.remainingKeys(user1), 3);
    }

    // ====================================================================
    // ============ Key Rotation After Usage ============
    // ====================================================================

    function test_rotateAfterUsage_resetsUsedKeys() public {
        bytes32 messageHash = keccak256("rotate-after-use");
        bytes32 seed = bytes32("rau-seed");
        (QuantumVault.LamportSignature memory sig, bytes32 publicKeyHash) = _buildLamportSig(messageHash, seed);
        (bytes32 merkleRoot, bytes32[] memory merkleProof) = _buildSingleLeafMerkle(publicKeyHash);

        vm.prank(user1);
        vault.registerQuantumKey(merkleRoot, 4);

        vault.verifyAndConsumeQuantumSignature(
            user1, messageHash, 0, publicKeyHash, merkleProof, sig
        );
        assertEq(vault.remainingKeys(user1), 3);

        // Rotate to new keys
        bytes32 newRoot = keccak256("new-root");
        vm.prank(user1);
        vault.rotateQuantumKey(newRoot, 8);

        assertEq(vault.remainingKeys(user1), 8);
    }

    // ====================================================================
    // ============ Admin Functions ============
    // ====================================================================

    function test_setProtectedContract_onlyOwner() public {
        address target = makeAddr("target-contract");

        // Owner can set
        vault.setProtectedContract(target, true);
        assertTrue(vault.protectedContracts(target));

        // Non-owner cannot
        vm.prank(attacker);
        vm.expectRevert();
        vault.setProtectedContract(target, false);
    }

    function test_setProtectedContract_toggleOff() public {
        address target = makeAddr("toggle-target");

        vault.setProtectedContract(target, true);
        assertTrue(vault.protectedContracts(target));

        vault.setProtectedContract(target, false);
        assertFalse(vault.protectedContracts(target));
    }

    function test_setProtectedContract_emitsEvent() public {
        address target = makeAddr("event-target");

        vm.expectEmit(true, false, false, true);
        emit ProtectedContractSet(target, true);
        vault.setProtectedContract(target, true);
    }

    function test_setQuantumThreshold_onlyOwner() public {
        vault.setQuantumThreshold(10 ether);
        assertEq(vault.quantumThreshold(), 10 ether);

        vm.prank(attacker);
        vm.expectRevert();
        vault.setQuantumThreshold(100 ether);
    }

    function test_setQuantumThreshold_emitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit ThresholdUpdated(1 ether, 5 ether);
        vault.setQuantumThreshold(5 ether);
    }

    function test_setQuantumThreshold_zero() public {
        vault.setQuantumThreshold(0);
        assertEq(vault.quantumThreshold(), 0);
    }

    function test_setQuantumThreshold_maxUint() public {
        vault.setQuantumThreshold(type(uint256).max);
        assertEq(vault.quantumThreshold(), type(uint256).max);
    }

    // ====================================================================
    // ============ UUPS Upgrade Authorization ============
    // ====================================================================

    function test_upgrade_onlyOwner() public {
        QuantumVault newImpl = new QuantumVault();

        // Owner can upgrade
        vault.upgradeToAndCall(address(newImpl), "");

        // Verify still works after upgrade
        assertEq(vault.quantumThreshold(), 1 ether);
    }

    function test_upgrade_revert_nonOwner() public {
        QuantumVault newImpl = new QuantumVault();

        vm.prank(attacker);
        vm.expectRevert();
        vault.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgrade_revert_notContract() public {
        // _authorizeUpgrade requires newImplementation.code.length > 0
        // The UUPS proxy itself validates this too, but we verify the custom check
        address eoa = makeAddr("not-a-contract");

        vm.expectRevert();
        vault.upgradeToAndCall(eoa, "");
    }

    // ====================================================================
    // ============ Initialization Guards ============
    // ====================================================================

    function test_initialize_cannotReinitialize() public {
        vm.expectRevert();
        vault.initialize(5 ether);
    }

    function test_implementationCannotBeInitialized() public {
        QuantumVault impl = new QuantumVault();
        vm.expectRevert();
        impl.initialize(1 ether);
    }

    // ====================================================================
    // ============ Revocation Cooldown Boundary ============
    // ====================================================================

    function test_revokeKey_exactBoundary_7days() public {
        uint256 start = 10000;
        vm.warp(start);

        vm.prank(user1);
        vault.registerQuantumKey(keccak256("root"), 64);

        // Exactly 7 days - 1 second: should fail
        vm.warp(start + 7 days - 1);
        vm.prank(user1);
        vm.expectRevert("Must wait 7 days to revoke");
        vault.revokeQuantumKey();

        // Exactly 7 days: should succeed
        vm.warp(start + 7 days);
        vm.prank(user1);
        vault.revokeQuantumKey();
        assertFalse(vault.hasQuantumProtection(user1));
    }

    function test_revokeKey_cooldownResetsOnRotation() public {
        uint256 start = 10000;
        vm.warp(start);

        vm.prank(user1);
        vault.registerQuantumKey(keccak256("root1"), 64);

        // 5 days later — rotate (resets registeredAt)
        vm.warp(start + 5 days);
        vm.prank(user1);
        vault.rotateQuantumKey(keccak256("root2"), 32);

        // 2 days later (7 days from original reg, but only 2 from rotation)
        vm.warp(start + 7 days);
        vm.prank(user1);
        vm.expectRevert("Must wait 7 days to revoke");
        vault.revokeQuantumKey();

        // 7 days from rotation should work
        vm.warp(start + 5 days + 7 days);
        vm.prank(user1);
        vault.revokeQuantumKey();
        assertFalse(vault.hasQuantumProtection(user1));
    }

    // ====================================================================
    // ============ Multiple Users Isolation ============
    // ====================================================================

    function test_multipleUsers_keysIsolated() public {
        vm.prank(user1);
        vault.registerQuantumKey(keccak256("root-u1"), 64);

        vm.prank(user2);
        vault.registerQuantumKey(keccak256("root-u2"), 128);

        assertTrue(vault.hasQuantumProtection(user1));
        assertTrue(vault.hasQuantumProtection(user2));
        assertEq(vault.remainingKeys(user1), 64);
        assertEq(vault.remainingKeys(user2), 128);

        // Revoking user1 doesn't affect user2
        vm.warp(block.timestamp + 8 days);
        vm.prank(user1);
        vault.revokeQuantumKey();

        assertFalse(vault.hasQuantumProtection(user1));
        assertTrue(vault.hasQuantumProtection(user2));
        assertEq(vault.remainingKeys(user1), 0);
        assertEq(vault.remainingKeys(user2), 128);
    }

    function test_usedKeyIds_scopedToUser() public {
        // Ensure that key ID hashing includes user address
        bytes32 keyId1 = keccak256(abi.encodePacked(user1, uint256(0)));
        bytes32 keyId2 = keccak256(abi.encodePacked(user2, uint256(0)));
        assertTrue(keyId1 != keyId2, "Key IDs should differ per user");
    }

    // ====================================================================
    // ============ Fuzz: Key Count Validation ============
    // ====================================================================

    function testFuzz_registerKeyCount(uint256 count) public {
        count = bound(count, 0, 1024);
        bool isPow2 = count > 0 && (count & (count - 1)) == 0;

        address user = makeAddr("fuzz-user");
        vm.prank(user);

        if (!isPow2) {
            vm.expectRevert(QuantumVault.InvalidKeyCount.selector);
        }
        vault.registerQuantumKey(keccak256("fuzz-root"), count);

        if (isPow2) {
            assertTrue(vault.hasQuantumProtection(user));
            assertEq(vault.remainingKeys(user), count);
        }
    }

    function testFuzz_threshold(uint256 newThreshold) public {
        vault.setQuantumThreshold(newThreshold);
        assertEq(vault.quantumThreshold(), newThreshold);
    }

    function testFuzz_revokeCooldownBoundary(uint256 waitSeconds) public {
        waitSeconds = bound(waitSeconds, 0, 30 days);

        uint256 start = 100000;
        vm.warp(start);

        address user = makeAddr("fuzz-revoke");
        vm.prank(user);
        vault.registerQuantumKey(keccak256("fuzz-root"), 64);

        vm.warp(start + waitSeconds);
        vm.prank(user);

        if (waitSeconds < 7 days) {
            vm.expectRevert("Must wait 7 days to revoke");
            vault.revokeQuantumKey();
        } else {
            vault.revokeQuantumKey();
            assertFalse(vault.hasQuantumProtection(user));
        }
    }
}
