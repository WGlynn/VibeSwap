// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/quantum/QuantumGuard.sol";

contract FuzzConcreteQG is QuantumGuard {
    function init(uint256 threshold, string memory name) external {
        _initQuantumGuard(threshold, name);
    }
}

contract QuantumGuardFuzzTest is Test {
    FuzzConcreteQG public qg;
    address public user;

    function setUp() public {
        qg = new FuzzConcreteQG();
        qg.init(1 ether, "TestQG");
        user = makeAddr("user");
        vm.warp(10 days); // Past any cooldown
    }

    /// @notice Valid power-of-2 sizes always register successfully
    function testFuzz_registerValidSizes(uint256 sizeIdx) public {
        sizeIdx = bound(sizeIdx, 0, 8);
        uint256[] memory validSizes = new uint256[](9);
        validSizes[0] = 1; validSizes[1] = 2; validSizes[2] = 4; validSizes[3] = 8;
        validSizes[4] = 16; validSizes[5] = 32; validSizes[6] = 64; validSizes[7] = 128; validSizes[8] = 256;

        vm.prank(user);
        qg.registerQuantumKey(keccak256("root"), validSizes[sizeIdx], false);
        assertTrue(qg.hasQuantumKey(user));
        assertEq(qg.quantumKeysRemaining(user), validSizes[sizeIdx]);
    }

    /// @notice Invalid key counts always revert
    function testFuzz_registerInvalidSizes(uint256 size) public {
        size = bound(size, 0, 1024);
        bool isPowerOf2 = size > 0 && size <= 256 && (size & (size - 1)) == 0;

        vm.prank(user);
        if (!isPowerOf2) {
            vm.expectRevert(QuantumGuard.InvalidKeyCount.selector);
        }
        qg.registerQuantumKey(keccak256("root"), size, false);
    }

    /// @notice Revocation cooldown boundary is exact
    function testFuzz_revokeCooldownBoundary(uint256 waitDays) public {
        waitDays = bound(waitDays, 0, 30);

        vm.prank(user);
        qg.registerQuantumKey(keccak256("root"), 64, false);

        vm.warp(block.timestamp + waitDays * 1 days);

        vm.prank(user);
        if (waitDays < 7) {
            vm.expectRevert(QuantumGuard.QuantumRevokeCooldown.selector);
            qg.revokeQuantumKey();
        } else {
            qg.revokeQuantumKey();
            assertFalse(qg.hasQuantumKey(user));
        }
    }

    /// @notice Rotation always resets used count
    function testFuzz_rotationResets(uint256 newSizeIdx) public {
        newSizeIdx = bound(newSizeIdx, 0, 8);
        uint256[] memory validSizes = new uint256[](9);
        validSizes[0] = 1; validSizes[1] = 2; validSizes[2] = 4; validSizes[3] = 8;
        validSizes[4] = 16; validSizes[5] = 32; validSizes[6] = 64; validSizes[7] = 128; validSizes[8] = 256;

        vm.prank(user);
        qg.registerQuantumKey(keccak256("root1"), 64, false);

        vm.prank(user);
        qg.rotateQuantumKey(keccak256("root2"), validSizes[newSizeIdx]);

        assertEq(qg.quantumKeysRemaining(user), validSizes[newSizeIdx]);
    }

    /// @notice Required flag persists across rotation
    function testFuzz_requiredFlagPersists(bool required) public {
        vm.prank(user);
        qg.registerQuantumKey(keccak256("root"), 64, required);

        vm.prank(user);
        qg.rotateQuantumKey(keccak256("root2"), 32);

        assertEq(qg.isQuantumRequired(user), required);
    }
}
