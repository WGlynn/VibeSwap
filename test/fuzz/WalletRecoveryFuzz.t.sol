// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/identity/WalletRecovery.sol";

// ============ Minimal Mocks ============

contract FuzzMockWRIdentity {
    mapping(uint256 => address) public owners;

    function setOwner(uint256 tokenId, address owner) external { owners[tokenId] = owner; }
    function ownerOf(uint256 tokenId) external view returns (address) { return owners[tokenId]; }
    function recoveryTransfer(uint256 tokenId, address newOwner) external { owners[tokenId] = newOwner; }
}

contract FuzzMockWRAGIGuard {
    function detectSuspiciousActivity(address, uint256, bytes32) external pure returns (bool, string memory) {
        return (false, "");
    }
}

// ============ Fuzz Tests ============

contract WalletRecoveryFuzzTest is Test {
    WalletRecovery public recovery;
    FuzzMockWRIdentity public identity;
    FuzzMockWRAGIGuard public agiGuard;
    address public owner;

    uint256 constant TOKEN_ID = 1;

    function setUp() public {
        owner = makeAddr("owner");
        identity = new FuzzMockWRIdentity();
        agiGuard = new FuzzMockWRAGIGuard();
        identity.setOwner(TOKEN_ID, owner);

        WalletRecovery impl = new WalletRecovery();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(WalletRecovery.initialize.selector, address(identity), address(agiGuard))
        );
        recovery = WalletRecovery(address(proxy));

        vm.warp(31 days); // Past MIN_ACCOUNT_AGE + ATTEMPT_COOLDOWN
    }

    /// @notice Guardian count never exceeds MAX_GUARDIANS
    function testFuzz_guardianCountBounded(uint8 count) public {
        count = uint8(bound(count, 1, 15)); // Some will fail at 11+

        uint256 added = 0;
        for (uint256 i = 0; i < count; i++) {
            address g = makeAddr(string(abi.encodePacked("guardian", i)));
            vm.prank(owner);
            try recovery.addGuardian(TOKEN_ID, g, "G") {
                added++;
            } catch {}
        }

        assertLe(added, 10); // MAX_GUARDIANS
    }

    /// @notice Timelock config always within bounds
    function testFuzz_timelockConfigBounds(uint256 timelockDuration, uint256 deadmanTimeout) public {
        timelockDuration = bound(timelockDuration, 0, 60 days);
        deadmanTimeout = bound(deadmanTimeout, 0, 730 days);

        bool validTimelock = timelockDuration >= 1 days && timelockDuration <= 30 days;
        bool validDeadman = deadmanTimeout >= 30 days;

        vm.prank(owner);
        if (!validTimelock || !validDeadman) {
            vm.expectRevert();
        }
        recovery.configureRecovery(TOKEN_ID, 0, timelockDuration, deadmanTimeout, address(0), bytes32(0), false);
    }

    /// @notice Recovery attempts per requester capped at MAX_RECOVERY_ATTEMPTS (3)
    function testFuzz_recoveryAttemptsTracked(uint8 attempts) public {
        attempts = uint8(bound(attempts, 1, 5)); // Max 3 succeed, 4-5 fail

        // Add guardian + configure for timelock recovery
        address g1 = makeAddr("g1");
        vm.prank(owner);
        recovery.addGuardian(TOKEN_ID, g1, "G1");
        vm.prank(owner);
        recovery.configureRecovery(TOKEN_ID, 1, 7 days, 365 days, address(0), bytes32(0), false);

        // Same requester for all attempts — tests per-user rate limit
        address requester = makeAddr("requester");
        vm.deal(requester, 10 ether);

        uint256 succeeded = 0;
        for (uint256 i = 0; i < attempts; i++) {
            vm.prank(requester);
            try recovery.initiateTimelockRecovery{value: 1 ether}(TOKEN_ID, makeAddr("new")) {
                succeeded++;
            } catch {}

            vm.warp(block.timestamp + 8 days); // Past cooldown
        }

        assertLe(succeeded, 3); // MAX_RECOVERY_ATTEMPTS per requester
    }

    /// @notice Deadman switch respects exact timeout boundary
    function testFuzz_deadmanTimeout(uint256 deadmanTimeout) public {
        deadmanTimeout = bound(deadmanTimeout, 30 days, 730 days);

        vm.prank(owner);
        recovery.addGuardian(TOKEN_ID, makeAddr("g"), "G");
        vm.prank(owner);
        recovery.configureRecovery(TOKEN_ID, 0, 7 days, deadmanTimeout, makeAddr("beneficiary"), bytes32(0), false);

        // Record activity now
        vm.prank(owner);
        recovery.recordActivity(TOKEN_ID);

        // Just before timeout
        vm.warp(block.timestamp + deadmanTimeout);
        assertFalse(recovery.isDeadmanTriggered(TOKEN_ID));

        // After timeout
        vm.warp(block.timestamp + 1);
        assertTrue(recovery.isDeadmanTriggered(TOKEN_ID));
    }

    /// @notice Bond is always slashed on cancel
    function testFuzz_bondSlashedOnCancel(uint256 bondAmount) public {
        bondAmount = bound(bondAmount, 1 ether, 10 ether);

        vm.prank(owner);
        recovery.addGuardian(TOKEN_ID, makeAddr("g"), "G");
        vm.prank(owner);
        recovery.configureRecovery(TOKEN_ID, 1, 7 days, 365 days, address(0), bytes32(0), false);

        address requester = makeAddr("requester");
        vm.deal(requester, bondAmount);

        vm.prank(requester);
        uint256 requestId = recovery.initiateTimelockRecovery{value: bondAmount}(TOKEN_ID, makeAddr("new"));

        uint256 ownerBalBefore = owner.balance;
        vm.prank(owner);
        recovery.cancelRecovery(TOKEN_ID, requestId);

        assertEq(owner.balance, ownerBalBefore + bondAmount);
    }
}
