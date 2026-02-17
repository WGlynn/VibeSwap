// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/quantum/QuantumVault.sol";

// ============ Handler ============

contract QVaultHandler is Test {
    QuantumVault public vault;

    uint256 public ghost_keysRegistered;
    uint256 public ghost_keysRevoked;

    address[] public users;

    constructor(QuantumVault _vault) {
        vault = _vault;
    }

    function registerKey(uint256 seed) public {
        address user = makeAddr(string(abi.encodePacked("user", ghost_keysRegistered)));
        bytes32 root = keccak256(abi.encodePacked("root", seed));

        // Valid power of 2 sizes
        uint256[] memory sizes = new uint256[](5);
        sizes[0] = 4; sizes[1] = 8; sizes[2] = 16; sizes[3] = 32; sizes[4] = 64;
        uint256 size = sizes[seed % 5];

        vm.prank(user);
        try vault.registerQuantumKey(root, size) {
            ghost_keysRegistered++;
            users.push(user);
        } catch {}
    }

    function revokeKey(uint256 seed) public {
        if (users.length == 0) return;
        uint256 idx = seed % users.length;

        vm.prank(users[idx]);
        try vault.revokeQuantumKey() {
            ghost_keysRevoked++;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1 days, 30 days);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract QuantumVaultInvariantTest is StdInvariant, Test {
    QuantumVault public vault;
    QVaultHandler public handler;

    function setUp() public {
        QuantumVault impl = new QuantumVault();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(QuantumVault.initialize.selector, 1 ether)
        );
        vault = QuantumVault(address(proxy));

        handler = new QVaultHandler(vault);
        targetContract(address(handler));
    }

    /// @notice Registrations always exceed revocations
    function invariant_registrationsGeRevocations() public view {
        assertGe(handler.ghost_keysRegistered(), handler.ghost_keysRevoked());
    }

    /// @notice Constants are always set
    function invariant_constantsSet() public view {
        assertEq(vault.CHUNKS(), 32);
        assertEq(vault.CHUNK_VALUES(), 256);
    }
}
