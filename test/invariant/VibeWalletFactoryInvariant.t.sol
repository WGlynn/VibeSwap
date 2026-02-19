// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/account/VibeWalletFactory.sol";

// ============ Handler ============

contract WalletFactoryHandler is Test {
    VibeWalletFactory public factory;

    // Ghost variables
    address[] public ghost_deployedWallets;
    mapping(address => bool) public ghost_walletExists;
    uint256 public ghost_createCount;

    constructor(VibeWalletFactory _factory) {
        factory = _factory;
    }

    function createAccount(uint256 ownerSeed, uint256 saltSeed) public {
        // Derive owner (avoid address(0))
        address owner = address(uint160(bound(ownerSeed, 1, type(uint160).max)));
        bytes32 salt = bytes32(saltSeed);

        address wallet = factory.createAccount(owner, salt);

        if (!ghost_walletExists[wallet]) {
            ghost_deployedWallets.push(wallet);
            ghost_walletExists[wallet] = true;
        }
        ghost_createCount++;
    }

    function deployedCount() external view returns (uint256) {
        return ghost_deployedWallets.length;
    }
}

// ============ Invariant Tests ============

contract VibeWalletFactoryInvariantTest is StdInvariant, Test {
    VibeWalletFactory public factory;
    WalletFactoryHandler public handler;

    function setUp() public {
        address entryPoint = makeAddr("entryPoint");
        factory = new VibeWalletFactory(entryPoint);
        handler = new WalletFactoryHandler(factory);
        targetContract(address(handler));
    }

    /// @notice Every deployed wallet has code (is a contract)
    function invariant_allWalletsHaveCode() public view {
        for (uint256 i = 0; i < handler.deployedCount(); i++) {
            address wallet = handler.ghost_deployedWallets(i);
            assertGt(wallet.code.length, 0, "Deployed wallet has no code");
        }
    }

    /// @notice Unique wallets never collide (no two different inputs produce same address)
    function invariant_noAddressCollisions() public view {
        uint256 count = handler.deployedCount();
        for (uint256 i = 0; i < count && i < 50; i++) {
            for (uint256 j = i + 1; j < count && j < 50; j++) {
                assertTrue(
                    handler.ghost_deployedWallets(i) != handler.ghost_deployedWallets(j),
                    "Address collision detected"
                );
            }
        }
    }

    /// @notice Create count >= deployed count (idempotent creates don't add new wallets)
    function invariant_createCountGteDeployed() public view {
        assertGe(handler.ghost_createCount(), handler.deployedCount(), "More wallets than creates");
    }
}
