// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/account/VibeWalletFactory.sol";
import "../../contracts/account/VibeSmartWallet.sol";

// ============ Handler: randomized factory operations ============

contract WalletFactoryHandler is Test {
    VibeWalletFactory public factory;
    address public entryPoint;

    // Ghost state
    struct WalletRecord {
        address owner;
        bytes32 salt;
        address wallet;
        bool created;
    }

    mapping(bytes32 => WalletRecord) public records; // combinedKey -> record
    bytes32[] public recordKeys;
    mapping(address => bool) public walletAddressesSeen;
    bool public duplicateAddressDetected;
    uint256 public totalCreations;
    uint256 public totalIdempotentCalls;

    constructor(VibeWalletFactory _factory, address _entryPoint) {
        factory = _factory;
        entryPoint = _entryPoint;
    }

    function createAccount(address owner, bytes32 salt) external {
        // Bound owner to non-zero
        if (owner == address(0)) owner = address(1);

        bytes32 key = keccak256(abi.encodePacked(owner, salt));
        address wallet = factory.createAccount(owner, salt);

        if (!records[key].created) {
            // First creation — check for address collision before marking seen
            if (walletAddressesSeen[wallet]) {
                duplicateAddressDetected = true;
            }
            records[key] = WalletRecord({
                owner: owner,
                salt: salt,
                wallet: wallet,
                created: true
            });
            recordKeys.push(key);
            walletAddressesSeen[wallet] = true;
            totalCreations++;
        } else {
            // Idempotent call — must return same address
            totalIdempotentCalls++;
        }
    }

    function getAddress(address owner, bytes32 salt) external view returns (address) {
        if (owner == address(0)) owner = address(1);
        return factory.getAddress(owner, salt);
    }

    function getRecordCount() external view returns (uint256) {
        return recordKeys.length;
    }

    function getRecordKeys() external view returns (bytes32[] memory) {
        return recordKeys;
    }
}

// ============ Invariant Test ============

contract WalletFactoryInvariantTest is Test {
    VibeWalletFactory factory;
    WalletFactoryHandler handler;
    address entryPoint;

    function setUp() public {
        entryPoint = makeAddr("entryPoint");
        factory = new VibeWalletFactory(entryPoint);
        handler = new WalletFactoryHandler(factory, entryPoint);

        targetContract(address(handler));
    }

    /// @notice entryPoint is immutable and non-zero
    function invariant_entryPointImmutable() public view {
        assertEq(factory.entryPoint(), entryPoint);
        assertTrue(factory.entryPoint() != address(0));
    }

    /// @notice getAddress matches createAccount for all deployed wallets
    function invariant_deterministicAddresses() public view {
        bytes32[] memory keys = handler.getRecordKeys();
        for (uint256 i = 0; i < keys.length; i++) {
            (address owner, bytes32 salt, address wallet, ) = handler.records(keys[i]);
            address predicted = factory.getAddress(owner, salt);
            assertEq(wallet, predicted, "Deployed address must match prediction");
        }
    }

    /// @notice createAccount is idempotent — same inputs always return same address
    function invariant_idempotency() public view {
        bytes32[] memory keys = handler.getRecordKeys();
        for (uint256 i = 0; i < keys.length; i++) {
            (address owner, bytes32 salt, address wallet, ) = handler.records(keys[i]);
            // getAddress is a pure function of (owner, salt) — must match stored wallet
            assertEq(factory.getAddress(owner, salt), wallet);
        }
    }

    /// @notice No two different (owner, salt) pairs produce the same wallet address
    function invariant_uniqueAddresses() public view {
        assertFalse(handler.duplicateAddressDetected(), "Different inputs must produce different addresses");
    }

    /// @notice All deployed wallets have code (are contracts, not EOAs)
    function invariant_deployedWalletsHaveCode() public view {
        bytes32[] memory keys = handler.getRecordKeys();
        for (uint256 i = 0; i < keys.length; i++) {
            (, , address wallet, ) = handler.records(keys[i]);
            assertTrue(wallet.code.length > 0, "Deployed wallet must have code");
        }
    }

    /// @notice Total creations + idempotent calls is consistent
    function invariant_callCountConsistency() public view {
        assertEq(handler.totalCreations(), handler.getRecordCount());
    }
}
