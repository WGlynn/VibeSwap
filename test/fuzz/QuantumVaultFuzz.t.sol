// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/quantum/QuantumVault.sol";

contract QuantumVaultFuzzTest is Test {
    QuantumVault public vault;

    function setUp() public {
        QuantumVault impl = new QuantumVault();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(QuantumVault.initialize.selector, 1 ether)
        );
        vault = QuantumVault(address(proxy));
    }

    /// @notice Key count must be power of 2
    function testFuzz_keyCountValidation(uint256 keyCount) public {
        keyCount = bound(keyCount, 0, 1024);
        address user = makeAddr("user");

        bool isPowerOf2 = keyCount > 0 && (keyCount & (keyCount - 1)) == 0;

        vm.prank(user);
        if (!isPowerOf2) {
            vm.expectRevert(QuantumVault.InvalidKeyCount.selector);
        }
        vault.registerQuantumKey(keccak256("root"), keyCount);

        if (isPowerOf2) {
            assertTrue(vault.hasQuantumProtection(user));
            assertEq(vault.remainingKeys(user), keyCount);
        }
    }

    /// @notice Rotation resets used count
    function testFuzz_rotationResetsUsed(uint256 initialSize, uint256 newSize) public {
        // Only test valid power-of-2 sizes
        uint256[] memory validSizes = new uint256[](9);
        validSizes[0] = 1; validSizes[1] = 2; validSizes[2] = 4; validSizes[3] = 8;
        validSizes[4] = 16; validSizes[5] = 32; validSizes[6] = 64; validSizes[7] = 128; validSizes[8] = 256;

        uint256 idx1 = bound(initialSize, 0, 8);
        uint256 idx2 = bound(newSize, 0, 8);

        address user = makeAddr("user");
        vm.prank(user);
        vault.registerQuantumKey(keccak256("root1"), validSizes[idx1]);

        vm.prank(user);
        vault.rotateQuantumKey(keccak256("root2"), validSizes[idx2]);

        assertEq(vault.remainingKeys(user), validSizes[idx2]);
    }

    /// @notice Threshold is always stored correctly
    function testFuzz_thresholdStored(uint256 threshold) public {
        vault.setQuantumThreshold(threshold);
        assertEq(vault.quantumThreshold(), threshold);
    }

    /// @notice Revocation respects 7-day cooldown
    function testFuzz_revokeCooldown(uint256 waitDays) public {
        waitDays = bound(waitDays, 0, 30);

        address user = makeAddr("user");
        vm.prank(user);
        vault.registerQuantumKey(keccak256("root"), 64);

        vm.warp(block.timestamp + waitDays * 1 days);

        vm.prank(user);
        if (waitDays < 7) {
            vm.expectRevert("Must wait 7 days to revoke");
            vault.revokeQuantumKey();
        } else {
            vault.revokeQuantumKey();
            assertFalse(vault.hasQuantumProtection(user));
        }
    }
}
