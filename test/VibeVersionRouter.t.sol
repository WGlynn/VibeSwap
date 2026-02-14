// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/proxy/VibeVersionRouter.sol";
import "../contracts/proxy/interfaces/IVibeVersionRouter.sol";

// ============ Mock Implementations ============

contract MockImplV1 {
    function version() external pure returns (string memory) { return "v1"; }
}

contract MockImplV2 {
    function version() external pure returns (string memory) { return "v2"; }
}

contract MockImplV3 {
    function version() external pure returns (string memory) { return "v3"; }
}

// ============ Unit Tests ============

contract VibeVersionRouterTest is Test {
    VibeVersionRouter public router;
    MockImplV1 public implV1;
    MockImplV2 public implV2;
    MockImplV3 public implV3;

    address public alice;
    address public bob;

    function setUp() public {
        router = new VibeVersionRouter();
        implV1 = new MockImplV1();
        implV2 = new MockImplV2();
        implV3 = new MockImplV3();

        alice = makeAddr("alice");
        bob = makeAddr("bob");
    }

    // ============ Register Tests ============

    function test_registerVersion() public {
        router.registerVersion(address(implV1), "v1.0-stable");

        IVibeVersionRouter.Version memory v = router.getVersion(0);
        assertEq(v.implementation, address(implV1));
        assertEq(uint8(v.status), uint8(IVibeVersionRouter.VersionStatus.BETA));
        assertEq(v.versionNumber, 1);
        assertEq(v.label, "v1.0-stable");
        assertEq(router.totalVersions(), 1);
    }

    function test_registerVersion_firstBecomesDefault() public {
        router.registerVersion(address(implV1), "v1");
        assertEq(router.defaultVersion(), 0);
    }

    function test_registerVersion_secondDoesNotOverrideDefault() public {
        router.registerVersion(address(implV1), "v1");
        router.registerVersion(address(implV2), "v2");
        assertEq(router.defaultVersion(), 0); // still v1
    }

    function test_registerVersion_revertsZeroAddress() public {
        vm.expectRevert(IVibeVersionRouter.ZeroAddress.selector);
        router.registerVersion(address(0), "v1");
    }

    function test_registerVersion_revertsDuplicate() public {
        router.registerVersion(address(implV1), "v1");
        vm.expectRevert(IVibeVersionRouter.DuplicateImplementation.selector);
        router.registerVersion(address(implV1), "v1-again");
    }

    function test_registerVersion_revertsNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        router.registerVersion(address(implV1), "v1");
    }

    // ============ Status Transition Tests ============

    function test_betaToStable() public {
        router.registerVersion(address(implV1), "v1");
        router.setVersionStatus(0, IVibeVersionRouter.VersionStatus.STABLE);

        IVibeVersionRouter.Version memory v = router.getVersion(0);
        assertEq(uint8(v.status), uint8(IVibeVersionRouter.VersionStatus.STABLE));
    }

    function test_stableToDeprecated() public {
        router.registerVersion(address(implV1), "v1");
        router.setVersionStatus(0, IVibeVersionRouter.VersionStatus.STABLE);
        router.setVersionStatus(0, IVibeVersionRouter.VersionStatus.DEPRECATED);

        IVibeVersionRouter.Version memory v = router.getVersion(0);
        assertEq(uint8(v.status), uint8(IVibeVersionRouter.VersionStatus.DEPRECATED));
        assertGt(v.deprecatedAt, 0);
    }

    function test_invalidTransition_betaToDeprecated() public {
        router.registerVersion(address(implV1), "v1");
        vm.expectRevert(IVibeVersionRouter.InvalidVersionTransition.selector);
        router.setVersionStatus(0, IVibeVersionRouter.VersionStatus.DEPRECATED);
    }

    function test_invalidTransition_deprecatedViaSetStatus() public {
        router.registerVersion(address(implV1), "v1");
        router.setVersionStatus(0, IVibeVersionRouter.VersionStatus.STABLE);
        router.setVersionStatus(0, IVibeVersionRouter.VersionStatus.DEPRECATED);

        vm.expectRevert(IVibeVersionRouter.InvalidVersionTransition.selector);
        router.setVersionStatus(0, IVibeVersionRouter.VersionStatus.SUNSET);
    }

    function test_sunsetVersion() public {
        router.registerVersion(address(implV1), "v1");
        router.sunsetVersion(0);

        IVibeVersionRouter.Version memory v = router.getVersion(0);
        assertEq(uint8(v.status), uint8(IVibeVersionRouter.VersionStatus.SUNSET));
    }

    function test_sunsetVersion_revertsAlreadySunset() public {
        router.registerVersion(address(implV1), "v1");
        router.sunsetVersion(0);

        vm.expectRevert(IVibeVersionRouter.VersionAlreadySunset.selector);
        router.sunsetVersion(0);
    }

    // ============ Default Version Tests ============

    function test_setDefaultVersion() public {
        router.registerVersion(address(implV1), "v1");
        router.registerVersion(address(implV2), "v2");

        router.setVersionStatus(1, IVibeVersionRouter.VersionStatus.STABLE);
        router.setDefaultVersion(1);

        assertEq(router.defaultVersion(), 1);
    }

    function test_setDefaultVersion_revertsNotStable() public {
        router.registerVersion(address(implV1), "v1");
        vm.expectRevert(IVibeVersionRouter.VersionNotActive.selector);
        router.setDefaultVersion(0); // BETA, not STABLE
    }

    function test_setDefaultVersion_revertsNotFound() public {
        vm.expectRevert(IVibeVersionRouter.VersionNotFound.selector);
        router.setDefaultVersion(999);
    }

    // ============ User Selection Tests ============

    function test_selectVersion() public {
        router.registerVersion(address(implV1), "v1");
        router.registerVersion(address(implV2), "v2");

        vm.prank(alice);
        router.selectVersion(1);

        assertEq(router.userVersion(alice), 1);
    }

    function test_selectVersion_revertsNotFound() public {
        vm.prank(alice);
        vm.expectRevert(IVibeVersionRouter.VersionNotFound.selector);
        router.selectVersion(999);
    }

    function test_selectVersion_revertsSunset() public {
        router.registerVersion(address(implV1), "v1");
        router.sunsetVersion(0);

        vm.prank(alice);
        vm.expectRevert(IVibeVersionRouter.VersionNotActive.selector);
        router.selectVersion(0);
    }

    function test_userVersion_defaultWhenNotSelected() public {
        router.registerVersion(address(implV1), "v1");
        assertEq(router.userVersion(alice), 0); // default
    }

    // ============ getImplementation Tests ============

    function test_getImplementation_default() public {
        router.registerVersion(address(implV1), "v1");
        assertEq(router.getImplementation(alice), address(implV1));
    }

    function test_getImplementation_selected() public {
        router.registerVersion(address(implV1), "v1");
        router.registerVersion(address(implV2), "v2");

        vm.prank(alice);
        router.selectVersion(1);

        assertEq(router.getImplementation(alice), address(implV2));
    }

    function test_getImplementation_autoMigrateOnSunset() public {
        router.registerVersion(address(implV1), "v1");
        router.registerVersion(address(implV2), "v2");

        // Set v2 as stable and default
        router.setVersionStatus(1, IVibeVersionRouter.VersionStatus.STABLE);
        router.setDefaultVersion(1);

        // Alice selects v1
        vm.prank(alice);
        router.selectVersion(0);
        assertEq(router.getImplementation(alice), address(implV1));

        // Sunset v1
        router.sunsetVersion(0);

        // Alice auto-migrates to default (v2)
        assertEq(router.getImplementation(alice), address(implV2));
    }

    // ============ latestStableVersion Tests ============

    function test_latestStableVersion() public {
        router.registerVersion(address(implV1), "v1");
        router.setVersionStatus(0, IVibeVersionRouter.VersionStatus.STABLE);

        router.registerVersion(address(implV2), "v2");
        router.setVersionStatus(1, IVibeVersionRouter.VersionStatus.STABLE);

        assertEq(router.latestStableVersion(), 1);
    }

    function test_latestStableVersion_revertsWhenNone() public {
        router.registerVersion(address(implV1), "v1"); // BETA only
        vm.expectRevert(IVibeVersionRouter.VersionNotFound.selector);
        router.latestStableVersion();
    }

    // ============ Integration Tests ============

    function test_fullLifecycle() public {
        // 1. Register v1
        router.registerVersion(address(implV1), "v1.0-beta");
        assertEq(router.totalVersions(), 1);

        // 2. Promote to stable
        router.setVersionStatus(0, IVibeVersionRouter.VersionStatus.STABLE);

        // 3. Alice uses default (v1)
        assertEq(router.getImplementation(alice), address(implV1));

        // 4. Register v2
        router.registerVersion(address(implV2), "v2.0-beta");
        router.setVersionStatus(1, IVibeVersionRouter.VersionStatus.STABLE);

        // 5. Bob opts into v2
        vm.prank(bob);
        router.selectVersion(1);
        assertEq(router.getImplementation(bob), address(implV2));

        // 6. Alice still on v1
        assertEq(router.getImplementation(alice), address(implV1));

        // 7. Deprecate v1
        router.setVersionStatus(0, IVibeVersionRouter.VersionStatus.DEPRECATED);

        // 8. Update default to v2
        router.setDefaultVersion(1);

        // 9. Sunset v1 — Alice auto-migrates
        router.sunsetVersion(0);
        assertEq(router.getImplementation(alice), address(implV2));

        // 10. Register v3
        router.registerVersion(address(implV3), "v3.0-beta");
        assertEq(router.totalVersions(), 3);
    }

    function test_multipleUsersMultipleVersions() public {
        router.registerVersion(address(implV1), "v1");
        router.registerVersion(address(implV2), "v2");
        router.registerVersion(address(implV3), "v3");

        vm.prank(alice);
        router.selectVersion(0);

        vm.prank(bob);
        router.selectVersion(2);

        assertEq(router.getImplementation(alice), address(implV1));
        assertEq(router.getImplementation(bob), address(implV3));

        // Default user gets default (v1)
        address charlie = makeAddr("charlie");
        assertEq(router.getImplementation(charlie), address(implV1));
    }
}
