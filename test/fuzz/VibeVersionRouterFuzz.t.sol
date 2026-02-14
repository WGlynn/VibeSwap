// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/proxy/VibeVersionRouter.sol";
import "../../contracts/proxy/interfaces/IVibeVersionRouter.sol";

// ============ Fuzz Tests ============

contract VibeVersionRouterFuzzTest is Test {
    VibeVersionRouter public router;

    function setUp() public {
        router = new VibeVersionRouter();
    }

    function testFuzz_registerIncrementsTotalVersions(uint8 count) public {
        count = uint8(bound(count, 1, 30));

        for (uint8 i = 0; i < count; i++) {
            address impl = address(uint160(i + 10_000));
            router.registerVersion(impl, "test");
        }

        assertEq(router.totalVersions(), count);
    }

    function testFuzz_selectVersionPreserved(uint8 count, uint8 selection) public {
        count = uint8(bound(count, 1, 20));
        selection = uint8(bound(selection, 0, count - 1));

        for (uint8 i = 0; i < count; i++) {
            address impl = address(uint160(i + 20_000));
            router.registerVersion(impl, "test");
        }

        address user = makeAddr("user");
        vm.prank(user);
        router.selectVersion(selection);

        assertEq(router.userVersion(user), selection);
    }

    function testFuzz_getImplementationNeverZero(uint8 count) public {
        count = uint8(bound(count, 1, 10));

        for (uint8 i = 0; i < count; i++) {
            address impl = address(uint160(i + 30_000));
            router.registerVersion(impl, "test");
        }

        address user = makeAddr("user");
        address impl = router.getImplementation(user);
        assertTrue(impl != address(0), "Implementation must not be zero");
    }

    function testFuzz_versionNumberSequential(uint8 count) public {
        count = uint8(bound(count, 1, 20));

        for (uint8 i = 0; i < count; i++) {
            address impl = address(uint160(i + 40_000));
            router.registerVersion(impl, "test");

            IVibeVersionRouter.Version memory v = router.getVersion(i);
            assertEq(v.versionNumber, i + 1, "Version numbers must be sequential");
        }
    }

    function testFuzz_sunsetAutoMigratesToDefault(uint8 count, uint8 sunsetIdx) public {
        count = uint8(bound(count, 2, 10));
        sunsetIdx = uint8(bound(sunsetIdx, 0, count - 2)); // Don't sunset the last one

        for (uint8 i = 0; i < count; i++) {
            address impl = address(uint160(i + 50_000));
            router.registerVersion(impl, "test");
        }

        // Make last version stable and default
        uint256 lastId = count - 1;
        router.setVersionStatus(lastId, IVibeVersionRouter.VersionStatus.STABLE);
        router.setDefaultVersion(lastId);

        // User selects version to sunset
        address user = makeAddr("user");
        vm.prank(user);
        router.selectVersion(sunsetIdx);

        // Sunset it
        router.sunsetVersion(sunsetIdx);

        // User auto-migrates to default
        address expected = address(uint160(lastId + 50_000));
        assertEq(router.getImplementation(user), expected);
    }
}
