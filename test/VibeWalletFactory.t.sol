// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/account/VibeWalletFactory.sol";
import "../contracts/account/VibeSmartWallet.sol";

contract VibeWalletFactoryTest is Test {
    VibeWalletFactory public factory;
    address public entryPoint;
    address public owner1;
    address public owner2;

    event WalletCreated(address indexed wallet, address indexed owner, bytes32 salt);

    function setUp() public {
        entryPoint = makeAddr("entryPoint");
        owner1 = makeAddr("owner1");
        owner2 = makeAddr("owner2");

        factory = new VibeWalletFactory(entryPoint);
    }

    // ============ Constructor ============

    function test_constructor() public view {
        assertEq(factory.entryPoint(), entryPoint);
    }

    function test_constructor_zeroEntryPoint() public {
        vm.expectRevert(VibeWalletFactory.ZeroAddress.selector);
        new VibeWalletFactory(address(0));
    }

    // ============ createAccount ============

    function test_createAccount() public {
        bytes32 salt = bytes32(uint256(1));
        address wallet = factory.createAccount(owner1, salt);

        assertTrue(wallet != address(0));
        assertTrue(wallet.code.length > 0);
    }

    function test_createAccount_deterministicAddress() public {
        bytes32 salt = bytes32(uint256(1));

        address predicted = factory.getAddress(owner1, salt);
        address actual = factory.createAccount(owner1, salt);

        assertEq(actual, predicted);
    }

    function test_createAccount_differentSalts() public {
        bytes32 salt1 = bytes32(uint256(1));
        bytes32 salt2 = bytes32(uint256(2));

        address wallet1 = factory.createAccount(owner1, salt1);
        address wallet2 = factory.createAccount(owner1, salt2);

        assertTrue(wallet1 != wallet2);
    }

    function test_createAccount_differentOwners() public {
        bytes32 salt = bytes32(uint256(1));

        address wallet1 = factory.createAccount(owner1, salt);
        address wallet2 = factory.createAccount(owner2, salt);

        assertTrue(wallet1 != wallet2);
    }

    function test_createAccount_zeroOwner() public {
        vm.expectRevert(VibeWalletFactory.ZeroAddress.selector);
        factory.createAccount(address(0), bytes32(uint256(1)));
    }

    function test_createAccount_idempotent() public {
        bytes32 salt = bytes32(uint256(1));

        address wallet1 = factory.createAccount(owner1, salt);
        address wallet2 = factory.createAccount(owner1, salt);

        assertEq(wallet1, wallet2);
    }

    function test_createAccount_emitsEvent() public {
        bytes32 salt = bytes32(uint256(1));
        address predicted = factory.getAddress(owner1, salt);

        vm.expectEmit(true, true, false, true);
        emit WalletCreated(predicted, owner1, salt);
        factory.createAccount(owner1, salt);
    }

    // ============ getAddress ============

    function test_getAddress_consistentBeforeAndAfterDeploy() public {
        bytes32 salt = bytes32(uint256(42));

        address before = factory.getAddress(owner1, salt);
        factory.createAccount(owner1, salt);
        address after_ = factory.getAddress(owner1, salt);

        assertEq(before, after_);
    }

    function test_getAddress_differentInputs() public view {
        bytes32 salt = bytes32(uint256(1));

        address addr1 = factory.getAddress(owner1, salt);
        address addr2 = factory.getAddress(owner2, salt);
        address addr3 = factory.getAddress(owner1, bytes32(uint256(2)));

        assertTrue(addr1 != addr2);
        assertTrue(addr1 != addr3);
        assertTrue(addr2 != addr3);
    }
}
