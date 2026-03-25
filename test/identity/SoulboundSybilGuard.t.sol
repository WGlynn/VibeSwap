// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/SoulboundSybilGuard.sol";
import "../../contracts/incentives/ISybilGuard.sol";

// ============ Mock Contracts ============

/**
 * @notice Full mock of ISoulboundIdentity for testing SoulboundSybilGuard.
 * @dev Allows setting hasIdentity return value per address.
 */
contract MockSoulboundIdentity {
    mapping(address => bool) private _identities;

    function setIdentity(address addr, bool status) external {
        _identities[addr] = status;
    }

    function hasIdentity(address addr) external view returns (bool) {
        return _identities[addr];
    }
}

/**
 * @notice Identity mock that always returns true.
 */
contract AlwaysTrueIdentity {
    function hasIdentity(address) external pure returns (bool) {
        return true;
    }
}

/**
 * @notice Identity mock that always returns false.
 */
contract AlwaysFalseIdentity {
    function hasIdentity(address) external pure returns (bool) {
        return false;
    }
}

/**
 * @notice Identity mock that reverts on call (simulates broken contract).
 */
contract RevertingIdentity {
    function hasIdentity(address) external pure returns (bool) {
        revert("Identity contract broken");
    }
}

// ============ Test Contract ============

/**
 * @title SoulboundSybilGuard Unit Tests
 * @notice Comprehensive tests for the SoulboundSybilGuard adapter contract.
 * @dev Covers:
 *      - Construction and immutable state
 *      - isUniqueIdentity delegation to underlying identity contract
 *      - Edge cases: zero address, EOA addresses, multiple queries
 *      - Interface compliance (ISybilGuard)
 *      - Behavioral tests with various mock implementations
 *      - Revert propagation from underlying contract
 */
contract SoulboundSybilGuardTest is Test {
    SoulboundSybilGuard public guard;
    MockSoulboundIdentity public identity;

    address public alice;
    address public bob;
    address public charlie;

    function setUp() public {
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        charlie = makeAddr("charlie");

        identity = new MockSoulboundIdentity();
        guard = new SoulboundSybilGuard(address(identity));
    }

    // ============ Constructor Tests ============

    function test_constructor_setsIdentityImmutable() public view {
        assertEq(address(guard.identity()), address(identity));
    }

    function test_constructor_revertsOnZeroAddress() public {
        vm.expectRevert("Zero address");
        new SoulboundSybilGuard(address(0));
    }

    function test_constructor_acceptsNonZeroAddress() public {
        address randomAddr = makeAddr("random");
        SoulboundSybilGuard newGuard = new SoulboundSybilGuard(randomAddr);
        assertEq(address(newGuard.identity()), randomAddr);
    }

    // ============ isUniqueIdentity Delegation ============

    function test_isUniqueIdentity_returnsTrueForVerifiedAddress() public {
        identity.setIdentity(alice, true);

        bool result = guard.isUniqueIdentity(alice);

        assertTrue(result, "Should return true for verified address");
    }

    function test_isUniqueIdentity_returnsFalseForUnverifiedAddress() public view {
        // alice not set -> defaults to false in mapping
        bool result = guard.isUniqueIdentity(alice);

        assertFalse(result, "Should return false for unverified address");
    }

    function test_isUniqueIdentity_respectsIdentityStateChanges() public {
        // Initially unverified
        assertFalse(guard.isUniqueIdentity(alice));

        // Grant identity
        identity.setIdentity(alice, true);
        assertTrue(guard.isUniqueIdentity(alice));

        // Revoke identity
        identity.setIdentity(alice, false);
        assertFalse(guard.isUniqueIdentity(alice));
    }

    function test_isUniqueIdentity_multipleAddressesIndependent() public {
        identity.setIdentity(alice, true);
        identity.setIdentity(bob, false);
        identity.setIdentity(charlie, true);

        assertTrue(guard.isUniqueIdentity(alice));
        assertFalse(guard.isUniqueIdentity(bob));
        assertTrue(guard.isUniqueIdentity(charlie));
    }

    // ============ Edge Cases ============

    function test_isUniqueIdentity_zeroAddressQuery() public {
        // Querying address(0) should not revert; just return false
        bool result = guard.isUniqueIdentity(address(0));
        assertFalse(result);
    }

    function test_isUniqueIdentity_zeroAddressCanBeVerified() public {
        // Even address(0) can be marked as having identity in the mock
        identity.setIdentity(address(0), true);
        assertTrue(guard.isUniqueIdentity(address(0)));
    }

    function test_isUniqueIdentity_contractAddressQuery() public {
        // Query the guard's own address (a contract)
        assertFalse(guard.isUniqueIdentity(address(guard)));

        // Set it to verified
        identity.setIdentity(address(guard), true);
        assertTrue(guard.isUniqueIdentity(address(guard)));
    }

    function test_isUniqueIdentity_repeatedCallsSameResult() public {
        identity.setIdentity(alice, true);

        // Multiple calls should all return the same value (pure delegation, no state mutation)
        assertTrue(guard.isUniqueIdentity(alice));
        assertTrue(guard.isUniqueIdentity(alice));
        assertTrue(guard.isUniqueIdentity(alice));
    }

    // ============ Alternative Identity Implementations ============

    function test_alwaysTrueIdentity_allAddressesVerified() public {
        AlwaysTrueIdentity alwaysTrue = new AlwaysTrueIdentity();
        SoulboundSybilGuard alwaysTrueGuard = new SoulboundSybilGuard(address(alwaysTrue));

        assertTrue(alwaysTrueGuard.isUniqueIdentity(alice));
        assertTrue(alwaysTrueGuard.isUniqueIdentity(bob));
        assertTrue(alwaysTrueGuard.isUniqueIdentity(address(0)));
    }

    function test_alwaysFalseIdentity_noAddressesVerified() public {
        AlwaysFalseIdentity alwaysFalse = new AlwaysFalseIdentity();
        SoulboundSybilGuard alwaysFalseGuard = new SoulboundSybilGuard(address(alwaysFalse));

        assertFalse(alwaysFalseGuard.isUniqueIdentity(alice));
        assertFalse(alwaysFalseGuard.isUniqueIdentity(bob));
    }

    function test_revertingIdentity_propagatesRevert() public {
        RevertingIdentity reverting = new RevertingIdentity();
        SoulboundSybilGuard revertGuard = new SoulboundSybilGuard(address(reverting));

        vm.expectRevert("Identity contract broken");
        revertGuard.isUniqueIdentity(alice);
    }

    // ============ Interface Compliance ============

    function test_implementsISybilGuard() public view {
        // Verify the guard can be cast to ISybilGuard (compile-time check
        // enforced by the contract, but we confirm runtime behavior)
        ISybilGuard sybilGuard = ISybilGuard(address(guard));

        identity.setIdentity(alice, true);
        assertTrue(sybilGuard.isUniqueIdentity(alice));
    }

    // ============ Immutability ============

    function test_identityAddressIsImmutable() public view {
        // The identity address is set in the constructor and cannot change.
        // Read it twice and confirm it is the same — there is no setter.
        address first = address(guard.identity());
        address second = address(guard.identity());
        assertEq(first, second);
        assertEq(first, address(identity));
    }

    // ============ Fuzz Tests ============

    function testFuzz_isUniqueIdentity_matchesUnderlying(address addr, bool status) public {
        identity.setIdentity(addr, status);

        bool guardResult = guard.isUniqueIdentity(addr);
        bool directResult = identity.hasIdentity(addr);

        assertEq(guardResult, directResult, "Guard must exactly mirror underlying identity contract");
    }

    function testFuzz_constructor_revertsOnlyForZeroAddress(address addr) public {
        if (addr == address(0)) {
            vm.expectRevert("Zero address");
            new SoulboundSybilGuard(addr);
        } else {
            // Should succeed for any non-zero address (even EOAs without code)
            SoulboundSybilGuard newGuard = new SoulboundSybilGuard(addr);
            assertEq(address(newGuard.identity()), addr);
        }
    }
}
