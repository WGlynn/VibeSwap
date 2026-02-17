// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/quantum/QuantumGuard.sol";

contract InvConcreteQG is QuantumGuard {
    function init(uint256 threshold, string memory name) external {
        _initQuantumGuard(threshold, name);
    }
}

// ============ Handler ============

contract QGHandler is Test {
    InvConcreteQG public qg;

    uint256 public ghost_registered;
    uint256 public ghost_revoked;
    uint256 public ghost_rotated;

    address[] public users;

    constructor(InvConcreteQG _qg) {
        qg = _qg;
    }

    function registerKey(uint256 seed) public {
        address user = makeAddr(string(abi.encodePacked("user", ghost_registered)));
        users.push(user);

        uint256[] memory validSizes = new uint256[](5);
        validSizes[0] = 4; validSizes[1] = 8; validSizes[2] = 16; validSizes[3] = 32; validSizes[4] = 64;

        vm.prank(user);
        try qg.registerQuantumKey(keccak256(abi.encodePacked("root", seed)), validSizes[seed % 5], seed % 2 == 0) {
            ghost_registered++;
        } catch {}
    }

    function revokeKey(uint256 seed) public {
        if (users.length == 0) return;
        address user = users[seed % users.length];

        vm.prank(user);
        try qg.revokeQuantumKey() {
            ghost_revoked++;
        } catch {}
    }

    function rotateKey(uint256 seed) public {
        if (users.length == 0) return;
        address user = users[seed % users.length];

        uint256[] memory validSizes = new uint256[](5);
        validSizes[0] = 4; validSizes[1] = 8; validSizes[2] = 16; validSizes[3] = 32; validSizes[4] = 64;

        vm.prank(user);
        try qg.rotateQuantumKey(keccak256(abi.encodePacked("newroot", seed)), validSizes[seed % 5]) {
            ghost_rotated++;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1 days, 30 days);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract QuantumGuardInvariantTest is StdInvariant, Test {
    InvConcreteQG public qg;
    QGHandler public handler;

    function setUp() public {
        qg = new InvConcreteQG();
        qg.init(1 ether, "TestQG");
        vm.warp(10 days);

        handler = new QGHandler(qg);
        targetContract(address(handler));
    }

    /// @notice Registrations always >= revocations
    function invariant_registrationsGeRevocations() public view {
        assertGe(handler.ghost_registered(), handler.ghost_revoked());
    }

    /// @notice Keys remaining never exceeds total keys for any user
    function invariant_keysRemainingBounded() public view {
        // Check first few users if they exist
        for (uint256 i = 0; i < 3 && i < handler.ghost_registered(); i++) {
            address user = handler.users(i);
            (,,,,bool active,) = qg.getQuantumKeyInfo(user);
            if (active) {
                (,uint256 totalKeys, uint256 usedCount,,,) = qg.getQuantumKeyInfo(user);
                assertGe(totalKeys, usedCount);
            }
        }
    }
}
