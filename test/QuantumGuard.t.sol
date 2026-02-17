// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/quantum/QuantumGuard.sol";
import "../contracts/quantum/LamportLib.sol";

// ============ Concrete Implementation ============

/// @dev Concrete wrapper so we can instantiate the abstract QuantumGuard and expose internals.
contract ConcreteQuantumGuard is QuantumGuard {
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

    /// @dev Expose internal storage for test assertions.
    function getUsedKeyBitmap(address user) external view returns (uint256) {
        return _quantumKeys[user].usedKeyBitmap;
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

contract QuantumGuardTest is Test {
    ConcreteQuantumGuard public guard;

    // ============ Re-declare Events ============

    event QuantumKeyRegistered(
        address indexed user,
        bytes32 merkleRoot,
        uint256 totalKeys,
        bool required
    );
    event QuantumKeyRotated(address indexed user, bytes32 newMerkleRoot, uint256 newTotalKeys);
    event QuantumKeyRevoked(address indexed user);
    event QuantumAuthVerified(address indexed user, uint256 keyIndex, bytes32 messageHash);
    event QuantumRequirementSet(address indexed user, bool required);

    // ============ Actors ============

    address public alice;
    address public bob;

    // ============ Constants ============

    bytes32 constant MERKLE_ROOT = keccak256("test-merkle-root");
    bytes32 constant MERKLE_ROOT_2 = keccak256("test-merkle-root-2");
    uint256 constant THRESHOLD = 1000 ether;
    string constant GUARD_NAME = "VibeSwapQuantum";

    // ============ Setup ============

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        guard = new ConcreteQuantumGuard();
        guard.init(THRESHOLD, GUARD_NAME);
    }

    // ============ Helpers ============

    /// @dev Register a key for `user` with given params, pranking as `user`.
    function _registerKey(address user, bytes32 root, uint256 totalKeys, bool required) internal {
        vm.prank(user);
        guard.registerQuantumKey(root, totalKeys, required);
    }

    /// @dev Build a dummy QuantumProof.  Crypto fields are zeroed; useful for
    ///      tests that only exercise key-management / view logic and won't hit
    ///      the actual Lamport verification path.
    function _dummyProof(uint256 keyIndex) internal pure returns (QuantumGuard.QuantumProof memory proof) {
        proof.keyIndex = keyIndex;
        proof.publicKeyHash = bytes32(0);
        proof.merkleProof = new bytes32[](0);
        // signature and oppositeHashes are zero-initialized by default
    }

    // ============ Initialization ============

    function test_initSetsThreshold() public view {
        assertEq(guard.getQuantumThreshold(), THRESHOLD);
    }

    function test_initSetsDomainSeparator() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("QuantumGuard(string name,uint256 chainId,address contract)"),
                keccak256(bytes(GUARD_NAME)),
                block.chainid,
                address(guard)
            )
        );
        assertEq(guard.getQuantumDomainSeparator(), expected);
    }

    // ============ Registration — Valid Power-of-2 Sizes ============

    function test_register_size1() public {
        _registerKey(alice, MERKLE_ROOT, 1, false);
        assertTrue(guard.hasQuantumKey(alice));
    }

    function test_register_size2() public {
        _registerKey(alice, MERKLE_ROOT, 2, false);
        (,,,,bool active,) = guard.getQuantumKeyInfo(alice);
        assertTrue(active);
    }

    function test_register_size4() public {
        _registerKey(alice, MERKLE_ROOT, 4, true);
        assertTrue(guard.isQuantumRequired(alice));
    }

    function test_register_size8() public {
        _registerKey(alice, MERKLE_ROOT, 8, false);
        assertEq(guard.quantumKeysRemaining(alice), 8);
    }

    function test_register_size16() public {
        _registerKey(alice, MERKLE_ROOT, 16, false);
        assertEq(guard.quantumKeysRemaining(alice), 16);
    }

    function test_register_size32() public {
        _registerKey(alice, MERKLE_ROOT, 32, false);
        assertEq(guard.quantumKeysRemaining(alice), 32);
    }

    function test_register_size64() public {
        _registerKey(alice, MERKLE_ROOT, 64, false);
        assertEq(guard.quantumKeysRemaining(alice), 64);
    }

    function test_register_size128() public {
        _registerKey(alice, MERKLE_ROOT, 128, false);
        assertEq(guard.quantumKeysRemaining(alice), 128);
    }

    function test_register_size256() public {
        _registerKey(alice, MERKLE_ROOT, 256, false);
        assertEq(guard.quantumKeysRemaining(alice), 256);
    }

    // ============ Registration — Invalid Sizes ============

    function test_register_revert_zeroKeys() public {
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.InvalidKeyCount.selector);
        guard.registerQuantumKey(MERKLE_ROOT, 0, false);
    }

    function test_register_revert_exceedsMax() public {
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.InvalidKeyCount.selector);
        guard.registerQuantumKey(MERKLE_ROOT, 512, false);
    }

    function test_register_revert_notPowerOf2_three() public {
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.InvalidKeyCount.selector);
        guard.registerQuantumKey(MERKLE_ROOT, 3, false);
    }

    function test_register_revert_notPowerOf2_five() public {
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.InvalidKeyCount.selector);
        guard.registerQuantumKey(MERKLE_ROOT, 5, false);
    }

    function test_register_revert_notPowerOf2_seven() public {
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.InvalidKeyCount.selector);
        guard.registerQuantumKey(MERKLE_ROOT, 7, false);
    }

    function test_register_revert_notPowerOf2_100() public {
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.InvalidKeyCount.selector);
        guard.registerQuantumKey(MERKLE_ROOT, 100, false);
    }

    function test_register_revert_notPowerOf2_255() public {
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.InvalidKeyCount.selector);
        guard.registerQuantumKey(MERKLE_ROOT, 255, false);
    }

    // ============ Registration — Event Emission ============

    function test_register_emitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit QuantumKeyRegistered(alice, MERKLE_ROOT, 64, true);
        guard.registerQuantumKey(MERKLE_ROOT, 64, true);
    }

    // ============ getQuantumKeyInfo ============

    function test_getKeyInfo_afterRegistration() public {
        uint256 regTime = 1000;
        vm.warp(regTime);
        _registerKey(alice, MERKLE_ROOT, 32, true);

        (
            bytes32 merkleRoot,
            uint256 totalKeys,
            uint256 usedCount,
            uint256 registeredAt,
            bool active,
            bool required
        ) = guard.getQuantumKeyInfo(alice);

        assertEq(merkleRoot, MERKLE_ROOT);
        assertEq(totalKeys, 32);
        assertEq(usedCount, 0);
        assertEq(registeredAt, regTime);
        assertTrue(active);
        assertTrue(required);
    }

    function test_getKeyInfo_unregisteredUser() public view {
        (
            bytes32 merkleRoot,
            uint256 totalKeys,
            uint256 usedCount,
            uint256 registeredAt,
            bool active,
            bool required
        ) = guard.getQuantumKeyInfo(bob);

        assertEq(merkleRoot, bytes32(0));
        assertEq(totalKeys, 0);
        assertEq(usedCount, 0);
        assertEq(registeredAt, 0);
        assertFalse(active);
        assertFalse(required);
    }

    // ============ Rotation ============

    function test_rotate_success() public {
        _registerKey(alice, MERKLE_ROOT, 64, false);

        vm.prank(alice);
        guard.rotateQuantumKey(MERKLE_ROOT_2, 128);

        (bytes32 root, uint256 total, uint256 used,,bool active,) = guard.getQuantumKeyInfo(alice);
        assertEq(root, MERKLE_ROOT_2);
        assertEq(total, 128);
        assertEq(used, 0);
        assertTrue(active);
    }

    function test_rotate_resetsUsedCount() public {
        // Register with 4 keys, the usedCount starts at 0
        _registerKey(alice, MERKLE_ROOT, 4, false);
        // We can't easily increment usedCount without a valid proof, but rotation
        // itself resets bitmap and count regardless. Verify fresh state.
        vm.prank(alice);
        guard.rotateQuantumKey(MERKLE_ROOT_2, 8);

        (,, uint256 usedCount,,,) = guard.getQuantumKeyInfo(alice);
        assertEq(usedCount, 0);
        assertEq(guard.getUsedKeyBitmap(alice), 0);
    }

    function test_rotate_resetsRegisteredAt() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 4, false);

        vm.warp(5000);
        vm.prank(alice);
        guard.rotateQuantumKey(MERKLE_ROOT_2, 8);

        (,,, uint256 registeredAt,,) = guard.getQuantumKeyInfo(alice);
        assertEq(registeredAt, 5000);
    }

    function test_rotate_emitsEvent() public {
        _registerKey(alice, MERKLE_ROOT, 32, false);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit QuantumKeyRotated(alice, MERKLE_ROOT_2, 128);
        guard.rotateQuantumKey(MERKLE_ROOT_2, 128);
    }

    function test_rotate_revert_inactive() public {
        // Never registered => not active
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.QuantumKeyNotActive.selector);
        guard.rotateQuantumKey(MERKLE_ROOT_2, 8);
    }

    function test_rotate_revert_invalidSize_zero() public {
        _registerKey(alice, MERKLE_ROOT, 4, false);

        vm.prank(alice);
        vm.expectRevert(QuantumGuard.InvalidKeyCount.selector);
        guard.rotateQuantumKey(MERKLE_ROOT_2, 0);
    }

    function test_rotate_revert_invalidSize_notPowerOf2() public {
        _registerKey(alice, MERKLE_ROOT, 4, false);

        vm.prank(alice);
        vm.expectRevert(QuantumGuard.InvalidKeyCount.selector);
        guard.rotateQuantumKey(MERKLE_ROOT_2, 6);
    }

    function test_rotate_revert_invalidSize_exceedsMax() public {
        _registerKey(alice, MERKLE_ROOT, 4, false);

        vm.prank(alice);
        vm.expectRevert(QuantumGuard.InvalidKeyCount.selector);
        guard.rotateQuantumKey(MERKLE_ROOT_2, 512);
    }

    // ============ Revocation ============

    function test_revoke_afterCooldown() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 32, false);

        // Warp past the 7-day cooldown
        vm.warp(1000 + 8 days);
        vm.prank(alice);
        guard.revokeQuantumKey();

        assertFalse(guard.hasQuantumKey(alice));
    }

    function test_revoke_emitsEvent() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 32, false);

        vm.warp(1000 + 8 days);
        vm.prank(alice);
        vm.expectEmit(true, false, false, false);
        emit QuantumKeyRevoked(alice);
        guard.revokeQuantumKey();
    }

    function test_revoke_revert_beforeCooldown() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 32, false);

        // Only 6 days later — still within cooldown
        vm.warp(1000 + 6 days);
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.QuantumRevokeCooldown.selector);
        guard.revokeQuantumKey();
    }

    function test_revoke_revert_exactCooldownBoundary() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 32, false);

        // Exactly at 7 days — timestamp < registeredAt + 7 days is false, so should succeed
        // registeredAt=1000, 1000+7days = 605800.  block.timestamp=605800 => NOT less => succeeds
        vm.warp(1000 + 7 days);
        vm.prank(alice);
        guard.revokeQuantumKey(); // should NOT revert
        assertFalse(guard.hasQuantumKey(alice));
    }

    function test_revoke_revert_inactive() public {
        // Never registered
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.QuantumKeyNotActive.selector);
        guard.revokeQuantumKey();
    }

    function test_revoke_revert_alreadyRevoked() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 32, false);

        vm.warp(1000 + 8 days);
        vm.prank(alice);
        guard.revokeQuantumKey();

        // Second revoke should fail (now inactive)
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.QuantumKeyNotActive.selector);
        guard.revokeQuantumKey();
    }

    // ============ setQuantumRequired ============

    function test_setRequired_toggleOn() public {
        _registerKey(alice, MERKLE_ROOT, 32, false);
        assertFalse(guard.isQuantumRequired(alice));

        vm.prank(alice);
        guard.setQuantumRequired(true);

        assertTrue(guard.isQuantumRequired(alice));
    }

    function test_setRequired_toggleOff() public {
        _registerKey(alice, MERKLE_ROOT, 32, true);
        assertTrue(guard.isQuantumRequired(alice));

        vm.prank(alice);
        guard.setQuantumRequired(false);

        assertFalse(guard.isQuantumRequired(alice));
    }

    function test_setRequired_emitsEvent() public {
        _registerKey(alice, MERKLE_ROOT, 32, false);

        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit QuantumRequirementSet(alice, true);
        guard.setQuantumRequired(true);
    }

    function test_setRequired_revert_inactive() public {
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.QuantumKeyNotActive.selector);
        guard.setQuantumRequired(true);
    }

    // ============ View Functions — hasQuantumKey ============

    function test_hasQuantumKey_true() public {
        _registerKey(alice, MERKLE_ROOT, 4, false);
        assertTrue(guard.hasQuantumKey(alice));
    }

    function test_hasQuantumKey_false_unregistered() public view {
        assertFalse(guard.hasQuantumKey(bob));
    }

    function test_hasQuantumKey_false_afterRevoke() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 4, false);

        vm.warp(1000 + 8 days);
        vm.prank(alice);
        guard.revokeQuantumKey();

        assertFalse(guard.hasQuantumKey(alice));
    }

    // ============ View Functions — isQuantumRequired ============

    function test_isQuantumRequired_true() public {
        _registerKey(alice, MERKLE_ROOT, 4, true);
        assertTrue(guard.isQuantumRequired(alice));
    }

    function test_isQuantumRequired_false_notRequired() public {
        _registerKey(alice, MERKLE_ROOT, 4, false);
        assertFalse(guard.isQuantumRequired(alice));
    }

    function test_isQuantumRequired_false_inactive() public view {
        // Never registered => active is false
        assertFalse(guard.isQuantumRequired(bob));
    }

    function test_isQuantumRequired_false_afterRevoke() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 4, true);
        assertTrue(guard.isQuantumRequired(alice));

        vm.warp(1000 + 8 days);
        vm.prank(alice);
        guard.revokeQuantumKey();

        // required was true, but active is false now — should return false
        assertFalse(guard.isQuantumRequired(alice));
    }

    // ============ View Functions — quantumKeysRemaining ============

    function test_keysRemaining_full() public {
        _registerKey(alice, MERKLE_ROOT, 64, false);
        assertEq(guard.quantumKeysRemaining(alice), 64);
    }

    function test_keysRemaining_zero_unregistered() public view {
        assertEq(guard.quantumKeysRemaining(bob), 0);
    }

    function test_keysRemaining_zero_afterRevoke() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 16, false);

        vm.warp(1000 + 8 days);
        vm.prank(alice);
        guard.revokeQuantumKey();

        assertEq(guard.quantumKeysRemaining(alice), 0);
    }

    // ============ View Functions — getQuantumMessageHash ============

    function test_getQuantumMessageHash_deterministic() public view {
        bytes memory data = abi.encode("transfer", alice, 100 ether);
        bytes32 hash1 = guard.getQuantumMessageHash(data);
        bytes32 hash2 = guard.getQuantumMessageHash(data);
        assertEq(hash1, hash2);
    }

    function test_getQuantumMessageHash_differentData() public view {
        bytes memory data1 = abi.encode("transfer", alice, 100 ether);
        bytes memory data2 = abi.encode("transfer", alice, 200 ether);
        bytes32 hash1 = guard.getQuantumMessageHash(data1);
        bytes32 hash2 = guard.getQuantumMessageHash(data2);
        assertTrue(hash1 != hash2);
    }

    function test_getQuantumMessageHash_usesDomainSeparator() public view {
        bytes memory data = abi.encode("test");
        bytes32 expected = LamportLib.hashStructuredMessage(
            guard.getQuantumDomainSeparator(),
            data
        );
        assertEq(guard.getQuantumMessageHash(data), expected);
    }

    // ============ verifyQuantumProof — State Checks (no real crypto) ============

    function test_verifyProof_returnsFalse_notActive() public view {
        QuantumGuard.QuantumProof memory proof = _dummyProof(0);
        // Bob never registered — not active
        bool valid = guard.verifyQuantumProof(bob, keccak256("msg"), proof);
        assertFalse(valid);
    }

    function test_verifyProof_returnsFalse_keyIndexExceedsTotal() public {
        _registerKey(alice, MERKLE_ROOT, 4, false);

        QuantumGuard.QuantumProof memory proof = _dummyProof(4); // index 4 with totalKeys=4 => out of bounds
        bool valid = guard.verifyQuantumProof(alice, keccak256("msg"), proof);
        assertFalse(valid);
    }

    function test_verifyProof_returnsFalse_keyIndexAtBoundary() public {
        _registerKey(alice, MERKLE_ROOT, 8, false);

        QuantumGuard.QuantumProof memory proof = _dummyProof(8); // exactly at totalKeys => out of bounds
        bool valid = guard.verifyQuantumProof(alice, keccak256("msg"), proof);
        assertFalse(valid);
    }

    function test_verifyProof_returnsFalse_keyIndexWayOverBounds() public {
        _registerKey(alice, MERKLE_ROOT, 2, false);

        QuantumGuard.QuantumProof memory proof = _dummyProof(200);
        bool valid = guard.verifyQuantumProof(alice, keccak256("msg"), proof);
        assertFalse(valid);
    }

    // ============ Registration — Overwrite / Re-register ============

    function test_register_overwritesPreviousKey() public {
        _registerKey(alice, MERKLE_ROOT, 4, false);
        _registerKey(alice, MERKLE_ROOT_2, 128, true);

        (bytes32 root, uint256 total,,,bool active, bool required) = guard.getQuantumKeyInfo(alice);
        assertEq(root, MERKLE_ROOT_2);
        assertEq(total, 128);
        assertTrue(active);
        assertTrue(required);
    }

    function test_register_afterRevoke_reactivates() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 4, false);

        vm.warp(1000 + 8 days);
        vm.prank(alice);
        guard.revokeQuantumKey();
        assertFalse(guard.hasQuantumKey(alice));

        // Re-register
        _registerKey(alice, MERKLE_ROOT_2, 16, true);
        assertTrue(guard.hasQuantumKey(alice));
        assertTrue(guard.isQuantumRequired(alice));
        assertEq(guard.quantumKeysRemaining(alice), 16);
    }

    // ============ Rotation — Preserves Required Flag ============

    function test_rotate_preservesRequiredFlag() public {
        _registerKey(alice, MERKLE_ROOT, 4, true);

        vm.prank(alice);
        guard.rotateQuantumKey(MERKLE_ROOT_2, 8);

        // required should remain true (rotation does not touch it)
        assertTrue(guard.isQuantumRequired(alice));
    }

    // ============ Multiple Users Independence ============

    function test_multipleUsers_independent() public {
        _registerKey(alice, MERKLE_ROOT, 16, true);
        _registerKey(bob, MERKLE_ROOT_2, 64, false);

        assertTrue(guard.hasQuantumKey(alice));
        assertTrue(guard.hasQuantumKey(bob));

        assertTrue(guard.isQuantumRequired(alice));
        assertFalse(guard.isQuantumRequired(bob));

        assertEq(guard.quantumKeysRemaining(alice), 16);
        assertEq(guard.quantumKeysRemaining(bob), 64);

        // Revoking alice does not affect bob
        vm.warp(block.timestamp + 8 days);
        vm.prank(alice);
        guard.revokeQuantumKey();

        assertFalse(guard.hasQuantumKey(alice));
        assertTrue(guard.hasQuantumKey(bob));
    }

    // ============ Edge Cases ============

    function test_register_maxBoundary_257reverts() public {
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.InvalidKeyCount.selector);
        guard.registerQuantumKey(MERKLE_ROOT, 257, false);
    }

    function test_rotate_afterRevoke_reverts() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 4, false);

        vm.warp(1000 + 8 days);
        vm.prank(alice);
        guard.revokeQuantumKey();

        vm.prank(alice);
        vm.expectRevert(QuantumGuard.QuantumKeyNotActive.selector);
        guard.rotateQuantumKey(MERKLE_ROOT_2, 8);
    }

    function test_setRequired_afterRevoke_reverts() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 4, false);

        vm.warp(1000 + 8 days);
        vm.prank(alice);
        guard.revokeQuantumKey();

        vm.prank(alice);
        vm.expectRevert(QuantumGuard.QuantumKeyNotActive.selector);
        guard.setQuantumRequired(true);
    }

    function test_revoke_cooldownResetsOnRotation() public {
        vm.warp(1000);
        _registerKey(alice, MERKLE_ROOT, 4, false);

        // Advance 6 days — not enough to revoke yet
        vm.warp(1000 + 6 days);

        // Rotate — this resets registeredAt
        vm.prank(alice);
        guard.rotateQuantumKey(MERKLE_ROOT_2, 8);

        // Try revoking 1 day later (7 days from original, but only 1 day from rotation)
        vm.warp(1000 + 7 days);
        vm.prank(alice);
        vm.expectRevert(QuantumGuard.QuantumRevokeCooldown.selector);
        guard.revokeQuantumKey();

        // Now wait 7 full days from rotation time
        vm.warp(1000 + 6 days + 7 days);
        vm.prank(alice);
        guard.revokeQuantumKey();
        assertFalse(guard.hasQuantumKey(alice));
    }
}
