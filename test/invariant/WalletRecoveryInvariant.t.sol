// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/identity/WalletRecovery.sol";

// ============ Mocks ============

contract InvMockWRIdentity {
    mapping(uint256 => address) public owners;

    function setOwner(uint256 tokenId, address owner) external { owners[tokenId] = owner; }
    function ownerOf(uint256 tokenId) external view returns (address) { return owners[tokenId]; }
    function recoveryTransfer(uint256 tokenId, address newOwner) external { owners[tokenId] = newOwner; }
}

contract InvMockWRAGIGuard {
    function detectSuspiciousActivity(address, uint256, bytes32) external pure returns (bool, string memory) {
        return (false, "");
    }
}

// ============ Handler ============

contract WRHandler is Test {
    WalletRecovery public recovery;
    address public owner;
    uint256 constant TOKEN_ID = 1;

    uint256 public ghost_guardiansAdded;
    uint256 public ghost_guardiansRemoved;
    uint256 public ghost_requestsCreated;

    constructor(WalletRecovery _recovery, address _owner) {
        recovery = _recovery;
        owner = _owner;
    }

    function addGuardian(uint256 seed) public {
        address g = makeAddr(string(abi.encodePacked("guardian", ghost_guardiansAdded)));

        vm.prank(owner);
        try recovery.addGuardian(TOKEN_ID, g, "G") {
            ghost_guardiansAdded++;
        } catch {}
    }

    function removeGuardian(uint256 seed) public {
        if (ghost_guardiansAdded == 0) return;
        uint256 idx = seed % ghost_guardiansAdded;
        address g = makeAddr(string(abi.encodePacked("guardian", idx)));

        vm.prank(owner);
        try recovery.removeGuardian(TOKEN_ID, g) {
            ghost_guardiansRemoved++;
        } catch {}
    }

    function recordActivity() public {
        vm.prank(owner);
        try recovery.recordActivity(TOKEN_ID) {} catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 30 days);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract WalletRecoveryInvariantTest is StdInvariant, Test {
    WalletRecovery public recovery;
    WRHandler public handler;
    address public owner;

    function setUp() public {
        owner = makeAddr("owner");
        InvMockWRIdentity identity = new InvMockWRIdentity();
        InvMockWRAGIGuard agiGuard = new InvMockWRAGIGuard();
        identity.setOwner(1, owner);

        WalletRecovery impl = new WalletRecovery();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(WalletRecovery.initialize.selector, address(identity), address(agiGuard))
        );
        recovery = WalletRecovery(address(proxy));

        vm.warp(31 days);

        handler = new WRHandler(recovery, owner);
        targetContract(address(handler));
    }

    /// @notice Constants never change
    function invariant_constantsImmutable() public view {
        assertEq(recovery.MAX_GUARDIANS(), 10);
        assertEq(recovery.MIN_TIMELOCK(), 1 days);
        assertEq(recovery.MAX_TIMELOCK(), 30 days);
        assertEq(recovery.RECOVERY_BOND(), 1 ether);
        assertEq(recovery.MAX_RECOVERY_ATTEMPTS(), 3);
        assertEq(recovery.NOTIFICATION_DELAY(), 24 hours);
    }

    /// @notice Active guardian count never exceeds MAX_GUARDIANS (10)
    function invariant_activeGuardiansBounded() public view {
        assertLe(recovery.getActiveGuardianCount(1), 10);
    }
}
