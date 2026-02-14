// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/proxy/VibeVersionRouter.sol";
import "../../contracts/proxy/interfaces/IVibeVersionRouter.sol";

// ============ Handler ============

contract VersionRouterHandler is Test {
    VibeVersionRouter public router;
    address public owner;

    // Ghost variables
    uint256 public ghost_registered;
    uint256 public ghost_selected;
    uint256 public ghost_sunsetted;

    uint256 private _implCounter;

    constructor(VibeVersionRouter _router, address _owner) {
        router = _router;
        owner = _owner;
        _implCounter = 500_000;
    }

    function registerVersion() public {
        address impl = address(uint160(++_implCounter));
        vm.prank(owner);
        try router.registerVersion(impl, "test") {
            ghost_registered++;
        } catch {}
    }

    function selectVersion(uint256 idSeed, uint256 userSeed) public {
        uint256 total = router.totalVersions();
        if (total == 0) return;
        uint256 id = idSeed % total;
        address user = address(uint160(bound(userSeed, 600_000, 600_050)));

        vm.prank(user);
        try router.selectVersion(id) {
            ghost_selected++;
        } catch {}
    }

    function promoteToStable(uint256 idSeed) public {
        uint256 total = router.totalVersions();
        if (total == 0) return;
        uint256 id = idSeed % total;

        vm.prank(owner);
        try router.setVersionStatus(id, IVibeVersionRouter.VersionStatus.STABLE) {} catch {}
    }

    function sunsetVersion(uint256 idSeed) public {
        uint256 total = router.totalVersions();
        if (total == 0) return;
        uint256 id = idSeed % total;

        vm.prank(owner);
        try router.sunsetVersion(id) {
            ghost_sunsetted++;
        } catch {}
    }
}

// ============ Invariant Tests ============

contract VersionRouterInvariantTest is StdInvariant, Test {
    VibeVersionRouter public router;
    VersionRouterHandler public handler;

    function setUp() public {
        router = new VibeVersionRouter();
        handler = new VersionRouterHandler(router, address(this));
        targetContract(address(handler));
    }

    /**
     * @notice totalVersions always matches ghost_registered.
     */
    function invariant_versionCountMatchesGhost() public view {
        assertEq(
            router.totalVersions(),
            handler.ghost_registered(),
            "Version count must match registrations"
        );
    }

    /**
     * @notice Every version is in a valid state (0-3).
     */
    function invariant_allVersionsValidState() public view {
        uint256 total = router.totalVersions();
        for (uint256 i = 0; i < total; i++) {
            IVibeVersionRouter.Version memory v = router.getVersion(i);
            uint8 state = uint8(v.status);
            assertTrue(state <= 3, "Invalid version state");
        }
    }

    /**
     * @notice Version numbers are sequential.
     */
    function invariant_versionNumbersSequential() public view {
        uint256 total = router.totalVersions();
        for (uint256 i = 0; i < total; i++) {
            IVibeVersionRouter.Version memory v = router.getVersion(i);
            assertEq(v.versionNumber, i + 1, "Version numbers must be sequential");
        }
    }

    /**
     * @notice Implementation addresses are never zero.
     */
    function invariant_noZeroImplementation() public view {
        uint256 total = router.totalVersions();
        for (uint256 i = 0; i < total; i++) {
            IVibeVersionRouter.Version memory v = router.getVersion(i);
            assertTrue(v.implementation != address(0), "Implementation must not be zero");
        }
    }

    function invariant_callSummary() public view {
        console.log("--- Version Router Invariant Summary ---");
        console.log("Registered:", handler.ghost_registered());
        console.log("Selected:", handler.ghost_selected());
        console.log("Sunset:", handler.ghost_sunsetted());
    }
}
