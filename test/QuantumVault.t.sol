// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/quantum/QuantumVault.sol";

contract QuantumVaultTest is Test {
    QuantumVault public vault;
    address public user1;
    address public user2;

    function setUp() public {
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");

        QuantumVault impl = new QuantumVault();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(QuantumVault.initialize.selector, 1 ether)
        );
        vault = QuantumVault(address(proxy));
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(vault.quantumThreshold(), 1 ether);
        assertEq(vault.CHUNKS(), 32);
        assertEq(vault.CHUNK_VALUES(), 256);
    }

    // ============ Key Registration ============

    function test_registerQuantumKey() public {
        bytes32 merkleRoot = keccak256("merkleRoot");
        vm.prank(user1);
        vault.registerQuantumKey(merkleRoot, 64); // 64 = 2^6, valid power of 2

        (bytes32 root, uint256 totalKeys, uint256 usedKeys, uint256 registeredAt, bool active) = vault.quantumKeys(user1);
        assertEq(root, merkleRoot);
        assertEq(totalKeys, 64);
        assertEq(usedKeys, 0);
        assertGt(registeredAt, 0);
        assertTrue(active);
    }

    function test_registerQuantumKey_alreadyRegistered() public {
        vm.prank(user1);
        vault.registerQuantumKey(keccak256("root1"), 64);

        vm.prank(user1);
        vm.expectRevert(QuantumVault.KeyAlreadyRegistered.selector);
        vault.registerQuantumKey(keccak256("root2"), 64);
    }

    function test_registerQuantumKey_invalidKeyCount_zero() public {
        vm.prank(user1);
        vm.expectRevert(QuantumVault.InvalidKeyCount.selector);
        vault.registerQuantumKey(keccak256("root"), 0);
    }

    function test_registerQuantumKey_invalidKeyCount_notPowerOf2() public {
        vm.prank(user1);
        vm.expectRevert(QuantumVault.InvalidKeyCount.selector);
        vault.registerQuantumKey(keccak256("root"), 3); // Not power of 2
    }

    function test_registerQuantumKey_validPowersOf2() public {
        // 1, 2, 4, 8, 16, 32, 64, 128, 256 are all valid
        address[] memory users = new address[](9);
        uint256[] memory sizes = new uint256[](9);
        sizes[0] = 1; sizes[1] = 2; sizes[2] = 4; sizes[3] = 8; sizes[4] = 16;
        sizes[5] = 32; sizes[6] = 64; sizes[7] = 128; sizes[8] = 256;

        for (uint256 i = 0; i < 9; i++) {
            users[i] = makeAddr(string(abi.encodePacked("user", i)));
            vm.prank(users[i]);
            vault.registerQuantumKey(keccak256(abi.encodePacked("root", i)), sizes[i]);
            assertTrue(vault.hasQuantumProtection(users[i]));
        }
    }

    // ============ Key Revocation ============

    function test_revokeQuantumKey() public {
        vm.prank(user1);
        vault.registerQuantumKey(keccak256("root"), 64);

        vm.warp(block.timestamp + 8 days);

        vm.prank(user1);
        vault.revokeQuantumKey();

        assertFalse(vault.hasQuantumProtection(user1));
    }

    function test_revokeQuantumKey_tooEarly() public {
        vm.prank(user1);
        vault.registerQuantumKey(keccak256("root"), 64);

        vm.warp(block.timestamp + 6 days);

        vm.prank(user1);
        vm.expectRevert("Must wait 7 days to revoke");
        vault.revokeQuantumKey();
    }

    function test_revokeQuantumKey_noKey() public {
        vm.prank(user1);
        vm.expectRevert(QuantumVault.NoQuantumKey.selector);
        vault.revokeQuantumKey();
    }

    // ============ Key Rotation ============

    function test_rotateQuantumKey() public {
        vm.prank(user1);
        vault.registerQuantumKey(keccak256("root1"), 64);

        bytes32 newRoot = keccak256("root2");
        vm.prank(user1);
        vault.rotateQuantumKey(newRoot, 128);

        (bytes32 root, uint256 totalKeys, uint256 usedKeys, , bool active) = vault.quantumKeys(user1);
        assertEq(root, newRoot);
        assertEq(totalKeys, 128);
        assertEq(usedKeys, 0);
        assertTrue(active);
    }

    function test_rotateQuantumKey_noKey() public {
        vm.prank(user1);
        vm.expectRevert(QuantumVault.NoQuantumKey.selector);
        vault.rotateQuantumKey(keccak256("root"), 64);
    }

    function test_rotateQuantumKey_invalidCount() public {
        vm.prank(user1);
        vault.registerQuantumKey(keccak256("root1"), 64);

        vm.prank(user1);
        vm.expectRevert(QuantumVault.InvalidKeyCount.selector);
        vault.rotateQuantumKey(keccak256("root2"), 5); // Not power of 2
    }

    // ============ View Functions ============

    function test_hasQuantumProtection() public {
        assertFalse(vault.hasQuantumProtection(user1));

        vm.prank(user1);
        vault.registerQuantumKey(keccak256("root"), 64);

        assertTrue(vault.hasQuantumProtection(user1));
    }

    function test_remainingKeys() public {
        assertEq(vault.remainingKeys(user1), 0);

        vm.prank(user1);
        vault.registerQuantumKey(keccak256("root"), 64);

        assertEq(vault.remainingKeys(user1), 64);
    }

    function test_remainingKeys_afterRevoke() public {
        vm.prank(user1);
        vault.registerQuantumKey(keccak256("root"), 64);

        vm.warp(block.timestamp + 8 days);
        vm.prank(user1);
        vault.revokeQuantumKey();

        assertEq(vault.remainingKeys(user1), 0);
    }

    // ============ Admin ============

    function test_setProtectedContract() public {
        address contract_ = makeAddr("contract");
        vault.setProtectedContract(contract_, true);
        assertTrue(vault.protectedContracts(contract_));
    }

    function test_setProtectedContract_onlyOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        vault.setProtectedContract(makeAddr("contract"), true);
    }

    function test_setQuantumThreshold() public {
        vault.setQuantumThreshold(10 ether);
        assertEq(vault.quantumThreshold(), 10 ether);
    }

    function test_setQuantumThreshold_onlyOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        vault.setQuantumThreshold(10 ether);
    }
}
