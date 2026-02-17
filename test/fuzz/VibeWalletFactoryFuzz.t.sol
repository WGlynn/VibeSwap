// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/account/VibeWalletFactory.sol";

contract VibeWalletFactoryFuzzTest is Test {
    VibeWalletFactory public factory;
    address public entryPoint;

    function setUp() public {
        entryPoint = makeAddr("entryPoint");
        factory = new VibeWalletFactory(entryPoint);
    }

    /// @notice getAddress is deterministic for same inputs
    function testFuzz_getAddressDeterministic(address owner, bytes32 salt) public view {
        vm.assume(owner != address(0));

        address addr1 = factory.getAddress(owner, salt);
        address addr2 = factory.getAddress(owner, salt);

        assertEq(addr1, addr2);
    }

    /// @notice Different owners produce different addresses
    function testFuzz_differentOwnersProduceDifferentAddresses(address owner1, address owner2, bytes32 salt) public view {
        vm.assume(owner1 != address(0) && owner2 != address(0));
        vm.assume(owner1 != owner2);

        address addr1 = factory.getAddress(owner1, salt);
        address addr2 = factory.getAddress(owner2, salt);

        assertTrue(addr1 != addr2);
    }

    /// @notice Different salts produce different addresses
    function testFuzz_differentSaltsProduceDifferentAddresses(address owner, bytes32 salt1, bytes32 salt2) public view {
        vm.assume(owner != address(0));
        vm.assume(salt1 != salt2);

        address addr1 = factory.getAddress(owner, salt1);
        address addr2 = factory.getAddress(owner, salt2);

        assertTrue(addr1 != addr2);
    }

    /// @notice createAccount matches getAddress prediction
    function testFuzz_createMatchesPrediction(bytes32 salt) public {
        address owner = makeAddr("owner");

        address predicted = factory.getAddress(owner, salt);
        address actual = factory.createAccount(owner, salt);

        assertEq(actual, predicted);
    }
}
