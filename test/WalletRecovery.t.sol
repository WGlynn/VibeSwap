// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/identity/WalletRecovery.sol";

// ============ Mocks ============

contract MockWRIdentity {
    mapping(uint256 => address) public owners;

    function setOwner(uint256 tokenId, address owner) external {
        owners[tokenId] = owner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return owners[tokenId];
    }

    function recoveryTransfer(uint256 tokenId, address newOwner) external {
        owners[tokenId] = newOwner;
    }
}

contract MockWRAGIGuard {
    bool public suspicious;
    string public indicator;

    function setSuspicious(bool _suspicious, string calldata _indicator) external {
        suspicious = _suspicious;
        indicator = _indicator;
    }

    function detectSuspiciousActivity(address, uint256, bytes32) external view returns (bool, string memory) {
        return (suspicious, indicator);
    }
}

// ============ Test Contract ============

contract WalletRecoveryTest is Test {

    // Re-declare events for expectEmit
    event GuardianAdded(uint256 indexed tokenId, address indexed guardian, string label);
    event GuardianRemoved(uint256 indexed tokenId, address indexed guardian);
    event RecoveryConfigured(uint256 indexed tokenId, uint256 threshold, uint256 timelock);
    event RecoveryInitiated(uint256 indexed tokenId, uint256 indexed requestId, WalletRecovery.RecoveryType recoveryType, address newOwner);
    event GuardianApproved(uint256 indexed tokenId, uint256 indexed requestId, address guardian);
    event RecoveryExecuted(uint256 indexed tokenId, uint256 indexed requestId, address oldOwner, address newOwner);
    event RecoveryCancelled(uint256 indexed tokenId, uint256 indexed requestId);
    event ArbitrationStarted(uint256 indexed caseId, uint256 indexed tokenId, bytes32 evidenceHash);
    event JurorVoted(uint256 indexed caseId, address indexed juror, WalletRecovery.Vote vote);
    event ArbitrationResolved(uint256 indexed caseId, bool approved);
    event ActivityRecorded(uint256 indexed tokenId);
    event JurorRegistered(address indexed juror);
    event RecoveryNotificationSent(uint256 indexed tokenId, uint256 indexed requestId, address newOwner, uint256 effectiveTime);
    event RecoveryBondPosted(uint256 indexed requestId, address indexed requester, uint256 amount);
    event RecoveryBondSlashed(uint256 indexed requestId, address indexed requester, uint256 amount, string reason);
    event RecoveryBondReturned(uint256 indexed requestId, address indexed requester, uint256 amount);
    event SuspiciousActivityDetected(uint256 indexed tokenId, address indexed requester, string indicator);
    event RecoveryBlocked(uint256 indexed requestId, string reason);

    WalletRecovery public wr;
    MockWRIdentity public identity;
    MockWRAGIGuard public agiGuard;

    // ============ Actors ============

    address public owner;       // test contract / deployer
    address public alice;       // identity owner
    address public bob;         // guardian 1
    address public carol;       // guardian 2
    address public dave;        // guardian 3
    address public eve;         // new owner (recovery target)
    address public frank;       // attacker / non-guardian

    // ============ Constants ============

    uint256 constant TOKEN_ID = 1;
    uint256 constant TIMELOCK_DURATION = 7 days;
    uint256 constant DEADMAN_TIMEOUT = 365 days;
    uint256 constant NOTIFICATION_DELAY = 24 hours;
    uint256 constant RECOVERY_BOND = 1 ether;
    uint256 constant JUROR_STAKE = 0.1 ether;

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        carol = makeAddr("carol");
        dave = makeAddr("dave");
        eve = makeAddr("eve");
        frank = makeAddr("frank");

        // Deploy mocks
        identity = new MockWRIdentity();
        agiGuard = new MockWRAGIGuard();

        // Deploy WalletRecovery via UUPS proxy
        WalletRecovery impl = new WalletRecovery();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                WalletRecovery.initialize.selector,
                address(identity),
                address(agiGuard)
            )
        );
        wr = WalletRecovery(address(proxy));

        // Warp past cooldown-at-zero (lastAttemptTime=0 + ATTEMPT_COOLDOWN=7d)
        vm.warp(8 days);

        // Set alice as identity owner for TOKEN_ID
        identity.setOwner(TOKEN_ID, alice);
    }

    // ============ Helpers ============

    /// @dev Add 3 guardians and configure recovery with threshold=2
    function _setupGuardiansAndConfig() internal {
        vm.startPrank(alice);
        wr.addGuardian(TOKEN_ID, bob, "Bob");
        wr.addGuardian(TOKEN_ID, carol, "Carol");
        wr.addGuardian(TOKEN_ID, dave, "Dave");
        wr.configureRecovery(
            TOKEN_ID,
            2,                          // guardianThreshold
            TIMELOCK_DURATION,          // timelockDuration
            DEADMAN_TIMEOUT,            // deadmanTimeout
            eve,                        // deadmanBeneficiary
            bytes32(0),                 // quantumBackupHash
            false                       // arbitrationEnabled
        );
        wr.recordActivity(TOKEN_ID);
        vm.stopPrank();
    }

    /// @dev Register N jurors starting from a seed address offset
    function _registerJurors(uint256 count) internal {
        for (uint256 i = 0; i < count; i++) {
            address juror = makeAddr(string(abi.encodePacked("juror", vm.toString(i))));
            vm.deal(juror, 1 ether);
            vm.prank(juror);
            wr.registerJuror{value: JUROR_STAKE}();
        }
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(address(wr.identityContract()), address(identity));
        assertEq(address(wr.agiGuard()), address(agiGuard));
    }

    function test_constants() public view {
        assertEq(wr.MIN_GUARDIANS(), 1);
        assertEq(wr.MAX_GUARDIANS(), 10);
        assertEq(wr.MIN_TIMELOCK(), 1 days);
        assertEq(wr.MAX_TIMELOCK(), 30 days);
        assertEq(wr.MIN_DEADMAN(), 30 days);
        assertEq(wr.JUROR_STAKE(), 0.1 ether);
        assertEq(wr.JURORS_PER_CASE(), 5);
        assertEq(wr.ARBITRATION_PERIOD(), 7 days);
        assertEq(wr.NOTIFICATION_DELAY(), 24 hours);
        assertEq(wr.RECOVERY_BOND(), 1 ether);
        assertEq(wr.MAX_RECOVERY_ATTEMPTS(), 3);
        assertEq(wr.ATTEMPT_COOLDOWN(), 7 days);
        assertEq(wr.MIN_ACCOUNT_AGE(), 30 days);
        assertEq(wr.MIN_BEHAVIORAL_SCORE(), 50);
    }

    // ============ Guardian Management ============

    function test_addGuardian_success() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit GuardianAdded(TOKEN_ID, bob, "Bob");
        wr.addGuardian(TOKEN_ID, bob, "Bob");

        WalletRecovery.Guardian[] memory guards = wr.getGuardians(TOKEN_ID);
        assertEq(guards.length, 1);
        assertEq(guards[0].addr, bob);
        assertEq(guards[0].label, "Bob");
        assertTrue(guards[0].isActive);
        assertEq(wr.getActiveGuardianCount(TOKEN_ID), 1);
    }

    function test_addGuardian_onlyOwner() public {
        vm.prank(frank);
        vm.expectRevert("Not identity owner");
        wr.addGuardian(TOKEN_ID, bob, "Bob");
    }

    function test_addGuardian_maxGuardians() public {
        vm.startPrank(alice);
        for (uint256 i = 0; i < 10; i++) {
            address g = makeAddr(string(abi.encodePacked("guard", vm.toString(i))));
            wr.addGuardian(TOKEN_ID, g, "Guardian");
        }

        // 11th should revert
        address extra = makeAddr("extra");
        vm.expectRevert("Too many guardians");
        wr.addGuardian(TOKEN_ID, extra, "Extra");
        vm.stopPrank();
    }

    function test_addGuardian_duplicate() public {
        vm.startPrank(alice);
        wr.addGuardian(TOKEN_ID, bob, "Bob");

        vm.expectRevert("Already a guardian");
        wr.addGuardian(TOKEN_ID, bob, "Bob Again");
        vm.stopPrank();
    }

    function test_addGuardian_zeroAddress() public {
        vm.prank(alice);
        vm.expectRevert("Invalid guardian");
        wr.addGuardian(TOKEN_ID, address(0), "Zero");
    }

    function test_addGuardian_self() public {
        vm.prank(alice);
        vm.expectRevert("Invalid guardian");
        wr.addGuardian(TOKEN_ID, alice, "Self");
    }

    function test_removeGuardian_success() public {
        vm.startPrank(alice);
        wr.addGuardian(TOKEN_ID, bob, "Bob");

        vm.expectEmit(true, true, false, true);
        emit GuardianRemoved(TOKEN_ID, bob);
        wr.removeGuardian(TOKEN_ID, bob);
        vm.stopPrank();

        WalletRecovery.Guardian[] memory guards = wr.getGuardians(TOKEN_ID);
        assertEq(guards.length, 1);
        assertFalse(guards[0].isActive);
        assertEq(wr.getActiveGuardianCount(TOKEN_ID), 0);
    }

    function test_removeGuardian_notFound() public {
        vm.prank(alice);
        vm.expectRevert("Guardian not found");
        wr.removeGuardian(TOKEN_ID, bob);
    }

    // ============ Recovery Config ============

    function test_configureRecovery_success() public {
        vm.startPrank(alice);
        wr.addGuardian(TOKEN_ID, bob, "Bob");
        wr.addGuardian(TOKEN_ID, carol, "Carol");

        bytes32 quantumHash = keccak256("quantum-backup");

        vm.expectEmit(true, false, false, true);
        emit RecoveryConfigured(TOKEN_ID, 2, TIMELOCK_DURATION);
        wr.configureRecovery(
            TOKEN_ID,
            2,                      // guardianThreshold
            TIMELOCK_DURATION,      // timelockDuration
            DEADMAN_TIMEOUT,        // deadmanTimeout
            eve,                    // deadmanBeneficiary
            quantumHash,            // quantumBackupHash
            true                    // arbitrationEnabled
        );
        vm.stopPrank();

        (
            uint256 guardianThreshold,
            uint256 timelockDuration,
            uint256 deadmanTimeout,
            address deadmanBeneficiary,
            bytes32 quantumBackupHash,
            bool arbitrationEnabled
        ) = wr.configs(TOKEN_ID);

        assertEq(guardianThreshold, 2);
        assertEq(timelockDuration, TIMELOCK_DURATION);
        assertEq(deadmanTimeout, DEADMAN_TIMEOUT);
        assertEq(deadmanBeneficiary, eve);
        assertEq(quantumBackupHash, quantumHash);
        assertTrue(arbitrationEnabled);
    }

    function test_configureRecovery_invalidTimelock() public {
        vm.startPrank(alice);
        wr.addGuardian(TOKEN_ID, bob, "Bob");

        // Too short
        vm.expectRevert("Invalid timelock");
        wr.configureRecovery(TOKEN_ID, 1, 12 hours, 365 days, eve, bytes32(0), false);

        // Too long
        vm.expectRevert("Invalid timelock");
        wr.configureRecovery(TOKEN_ID, 1, 31 days, 365 days, eve, bytes32(0), false);
        vm.stopPrank();
    }

    function test_configureRecovery_deadmanTooShort() public {
        vm.startPrank(alice);
        wr.addGuardian(TOKEN_ID, bob, "Bob");

        vm.expectRevert("Deadman too short");
        wr.configureRecovery(TOKEN_ID, 1, 7 days, 29 days, eve, bytes32(0), false);
        vm.stopPrank();
    }

    // ============ Guardian Recovery ============

    function test_guardianRecovery_success() public {
        _setupGuardiansAndConfig();

        // Bob initiates recovery (counts as 1 approval)
        vm.prank(bob);
        uint256 requestId = wr.initiateGuardianRecovery(TOKEN_ID, eve);
        assertEq(requestId, 1);

        // Carol approves (threshold=2 met)
        vm.prank(carol);
        wr.approveRecovery(TOKEN_ID, requestId);

        // Verify approvals
        (,,, , uint256 approvals,,) = wr.getRecoveryRequest(TOKEN_ID, requestId);
        assertEq(approvals, 2);

        // Execute — no notificationTime set for guardian recovery, so no delay needed
        wr.executeRecovery(TOKEN_ID, requestId);

        // Verify ownership transferred
        assertEq(identity.ownerOf(TOKEN_ID), eve);

        // Verify request marked executed
        (,,,,, bool executed,) = wr.getRecoveryRequest(TOKEN_ID, requestId);
        assertTrue(executed);
    }

    function test_guardianRecovery_notGuardian() public {
        _setupGuardiansAndConfig();

        vm.prank(frank);
        vm.expectRevert("Not a guardian");
        wr.initiateGuardianRecovery(TOKEN_ID, eve);
    }

    function test_guardianRecovery_notEnoughApprovals() public {
        _setupGuardiansAndConfig();

        // Only bob initiates (1 approval, threshold=2)
        vm.prank(bob);
        uint256 requestId = wr.initiateGuardianRecovery(TOKEN_ID, eve);

        // Try to execute without enough approvals
        vm.expectRevert("Recovery conditions not met");
        wr.executeRecovery(TOKEN_ID, requestId);
    }

    // ============ Timelock Recovery ============

    function test_timelockRecovery_success() public {
        _setupGuardiansAndConfig();

        // Frank initiates timelock recovery with bond
        vm.deal(frank, 2 ether);
        vm.prank(frank);
        uint256 requestId = wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);
        assertEq(requestId, 1);

        // Verify bond stored
        assertEq(wr.recoveryBonds(requestId), RECOVERY_BOND);

        // Warp past timelock + notification delay
        vm.warp(block.timestamp + TIMELOCK_DURATION + NOTIFICATION_DELAY + 1);

        // Execute
        uint256 frankBalBefore = frank.balance;
        wr.executeRecovery(TOKEN_ID, requestId);

        // Verify ownership transferred
        assertEq(identity.ownerOf(TOKEN_ID), eve);

        // Verify bond returned to requester
        assertEq(frank.balance, frankBalBefore + RECOVERY_BOND);
    }

    function test_timelockRecovery_insufficientBond() public {
        _setupGuardiansAndConfig();

        vm.deal(frank, 2 ether);
        vm.prank(frank);
        vm.expectRevert("Must post recovery bond");
        wr.initiateTimelockRecovery{value: 0.5 ether}(TOKEN_ID, eve);
    }

    function test_timelockRecovery_tooEarly() public {
        _setupGuardiansAndConfig();

        vm.deal(frank, 2 ether);
        vm.prank(frank);
        uint256 requestId = wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);

        // Warp only past timelock but not notification delay
        vm.warp(block.timestamp + TIMELOCK_DURATION);

        vm.expectRevert("Recovery conditions not met");
        wr.executeRecovery(TOKEN_ID, requestId);
    }

    function test_timelockRecovery_rateLimited() public {
        _setupGuardiansAndConfig();

        vm.deal(frank, 10 ether);

        uint256 t0 = block.timestamp;

        // Attempt 1
        vm.prank(frank);
        wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);

        // Attempt 2 — must wait for cooldown
        vm.warp(t0 + 8 days);
        vm.prank(frank);
        wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);

        // Attempt 3 — must wait for cooldown
        vm.warp(t0 + 16 days);
        vm.prank(frank);
        wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);

        // Attempt 4 — should fail (max 3 attempts)
        vm.warp(t0 + 24 days);
        vm.prank(frank);
        vm.expectRevert("Max attempts exceeded");
        wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);
    }

    // ============ Deadman's Switch ============

    function test_deadmanSwitch_notTriggered() public {
        _setupGuardiansAndConfig();

        // Activity was recorded in setup, so deadman should not be triggered
        assertFalse(wr.isDeadmanTriggered(TOKEN_ID));
    }

    function test_deadmanSwitch_triggered() public {
        _setupGuardiansAndConfig();

        // Warp past deadman timeout (365 days)
        vm.warp(block.timestamp + DEADMAN_TIMEOUT + 1);

        assertTrue(wr.isDeadmanTriggered(TOKEN_ID));
    }

    function test_recordActivity_resetsTimer() public {
        _setupGuardiansAndConfig();

        // lastActivity was set during _setupGuardiansAndConfig at block.timestamp (8 days = 691200)
        // deadmanTimeout configured as 365 days = 31536000
        // Triggered when: block.timestamp > lastActivity + deadmanTimeout

        // Warp to 200 days — well within 365 day timeout
        vm.warp(200 days);
        assertFalse(wr.isDeadmanTriggered(TOKEN_ID));

        // Record activity to reset timer — lastActivity is now 200 days
        vm.prank(alice);
        wr.recordActivity(TOKEN_ID);
        assertEq(wr.lastActivity(TOKEN_ID), 200 days);

        // Warp 364 days after reset — should NOT trigger (200 + 364 = 564 days)
        vm.warp(564 days);
        assertFalse(wr.isDeadmanTriggered(TOKEN_ID));

        // Warp past the full timeout from the reset point (200 + 365 + 1 second)
        vm.warp(200 days + 365 days + 1);
        assertTrue(wr.isDeadmanTriggered(TOKEN_ID));
    }

    // ============ Cancel & Fraud ============

    function test_cancelRecovery_slashesBond() public {
        _setupGuardiansAndConfig();

        // Frank initiates timelock recovery with bond
        vm.deal(frank, 2 ether);
        vm.prank(frank);
        uint256 requestId = wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);

        // Alice (owner) cancels — bond slashed to owner
        uint256 aliceBalBefore = alice.balance;
        vm.prank(alice);
        wr.cancelRecovery(TOKEN_ID, requestId);

        // Verify bond sent to alice (owner)
        assertEq(alice.balance, aliceBalBefore + RECOVERY_BOND);

        // Verify request cancelled
        (,,,,,, bool cancelled) = wr.getRecoveryRequest(TOKEN_ID, requestId);
        assertTrue(cancelled);

        // Verify bond zeroed
        assertEq(wr.recoveryBonds(requestId), 0);
    }

    function test_cancelRecovery_onlyOwner() public {
        _setupGuardiansAndConfig();

        vm.deal(frank, 2 ether);
        vm.prank(frank);
        uint256 requestId = wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);

        // Non-owner tries to cancel
        vm.prank(frank);
        vm.expectRevert("Not owner");
        wr.cancelRecovery(TOKEN_ID, requestId);
    }

    function test_reportFraud_slashesBond() public {
        _setupGuardiansAndConfig();

        // Frank initiates timelock recovery with bond
        vm.deal(frank, 2 ether);
        vm.prank(frank);
        uint256 requestId = wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);

        bytes32 evidence = keccak256("fraud-evidence");

        // Bob (guardian) reports fraud
        uint256 bobBalBefore = bob.balance;
        vm.prank(bob);
        wr.reportFraud(TOKEN_ID, requestId, evidence);

        // Verify reporter gets half the bond
        assertEq(bob.balance, bobBalBefore + RECOVERY_BOND / 2);

        // Verify request cancelled
        (,,,,,, bool cancelled) = wr.getRecoveryRequest(TOKEN_ID, requestId);
        assertTrue(cancelled);

        // Verify fraudster permanently blocked (lastAttemptTime = type(uint256).max)
        assertEq(wr.lastAttemptTime(frank), type(uint256).max);

        // Verify bond zeroed
        assertEq(wr.recoveryBonds(requestId), 0);
    }

    // ============ Arbitration ============

    function test_registerJuror() public {
        address juror = makeAddr("juror0");
        vm.deal(juror, 1 ether);

        vm.prank(juror);
        vm.expectEmit(true, false, false, true);
        emit JurorRegistered(juror);
        wr.registerJuror{value: JUROR_STAKE}();

        assertTrue(wr.isJuror(juror));
        assertEq(wr.jurorStake(juror), JUROR_STAKE);
    }

    function test_jurorVoting() public {
        // Setup: enable arbitration
        vm.startPrank(alice);
        wr.addGuardian(TOKEN_ID, bob, "Bob");
        wr.addGuardian(TOKEN_ID, carol, "Carol");
        wr.addGuardian(TOKEN_ID, dave, "Dave");
        wr.configureRecovery(
            TOKEN_ID,
            2,                          // guardianThreshold
            TIMELOCK_DURATION,          // timelockDuration
            DEADMAN_TIMEOUT,            // deadmanTimeout
            eve,                        // deadmanBeneficiary
            bytes32(0),                 // quantumBackupHash
            true                        // arbitrationEnabled
        );
        wr.recordActivity(TOKEN_ID);
        vm.stopPrank();

        // Register 5 jurors (minimum required)
        _registerJurors(5);

        // Frank initiates arbitration recovery
        bytes32 evidence = keccak256("my-evidence");
        vm.deal(frank, 1 ether);
        vm.prank(frank);
        uint256 requestId = wr.initiateArbitrationRecovery{value: JUROR_STAKE}(TOKEN_ID, eve, evidence);
        assertEq(requestId, 1);

        // Case should be created
        uint256 caseId = wr.caseCounter();
        assertEq(caseId, 1);

        // Get assigned jurors and have majority vote Approve
        // Since juror selection is pseudo-random, we iterate through the pool
        // and try voting with each. The assigned ones will succeed.
        uint256 approveVotes = 0;
        for (uint256 i = 0; i < 5; i++) {
            address juror = makeAddr(string(abi.encodePacked("juror", vm.toString(i))));
            vm.prank(juror);
            try wr.voteOnCase(caseId, WalletRecovery.Vote.Approve) {
                approveVotes++;
            } catch {
                // Not an assigned juror or already voted — skip
            }
            // Early majority triggers auto-resolve
            if (approveVotes > 2) break;
        }

        // Majority reached (3 of 5) => case auto-resolved
        assertTrue(approveVotes >= 3, "Majority not reached - juror assignment may differ");
    }

    // ============ AGI Resistance ============

    function test_suspiciousActivityBlocked() public {
        _setupGuardiansAndConfig();

        // Configure AGI guard to flag suspicious
        agiGuard.setSuspicious(true, "Suspicious pattern detected");

        vm.deal(frank, 2 ether);
        vm.prank(frank);
        vm.expectRevert("Suspicious pattern detected");
        wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);
    }

    // ============ Edge Cases ============

    function test_approveRecovery_alreadyApproved() public {
        _setupGuardiansAndConfig();

        vm.prank(bob);
        uint256 requestId = wr.initiateGuardianRecovery(TOKEN_ID, eve);

        // Bob tries to approve again (already approved via initiation)
        vm.prank(bob);
        vm.expectRevert("Already approved");
        wr.approveRecovery(TOKEN_ID, requestId);
    }

    function test_executeRecovery_alreadyExecuted() public {
        _setupGuardiansAndConfig();

        vm.prank(bob);
        uint256 requestId = wr.initiateGuardianRecovery(TOKEN_ID, eve);

        vm.prank(carol);
        wr.approveRecovery(TOKEN_ID, requestId);

        wr.executeRecovery(TOKEN_ID, requestId);

        // Try executing again
        vm.expectRevert("Request closed");
        wr.executeRecovery(TOKEN_ID, requestId);
    }

    function test_cancelRecovery_alreadyCancelled() public {
        _setupGuardiansAndConfig();

        vm.deal(frank, 2 ether);
        vm.prank(frank);
        uint256 requestId = wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);

        vm.prank(alice);
        wr.cancelRecovery(TOKEN_ID, requestId);

        // Try cancelling again
        vm.prank(alice);
        vm.expectRevert("Request closed");
        wr.cancelRecovery(TOKEN_ID, requestId);
    }

    function test_timelockRecovery_notificationDelayEnforced() public {
        _setupGuardiansAndConfig();

        vm.deal(frank, 2 ether);
        vm.prank(frank);
        uint256 requestId = wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);

        // Warp past timelock but NOT past notification delay
        // For timelock execution: need initiatedAt + timelockDuration + NOTIFICATION_DELAY
        // The notification delay check: notificationTime[requestId] + NOTIFICATION_DELAY
        // Both must pass. With timelock=7d and notification=24h, warp 7d only.
        vm.warp(block.timestamp + TIMELOCK_DURATION);

        // Should fail on notification delay (24h not yet passed relative to timelock+notification)
        vm.expectRevert("Recovery conditions not met");
        wr.executeRecovery(TOKEN_ID, requestId);
    }

    function test_registerJuror_insufficientStake() public {
        address juror = makeAddr("juror_cheap");
        vm.deal(juror, 1 ether);

        vm.prank(juror);
        vm.expectRevert("Insufficient stake");
        wr.registerJuror{value: 0.05 ether}();
    }

    function test_registerJuror_alreadyRegistered() public {
        address juror = makeAddr("juror_dup");
        vm.deal(juror, 1 ether);

        vm.prank(juror);
        wr.registerJuror{value: JUROR_STAKE}();

        vm.prank(juror);
        vm.expectRevert("Already a juror");
        wr.registerJuror{value: JUROR_STAKE}();
    }

    function test_removeGuardian_onlyOwner() public {
        vm.prank(alice);
        wr.addGuardian(TOKEN_ID, bob, "Bob");

        vm.prank(frank);
        vm.expectRevert("Not identity owner");
        wr.removeGuardian(TOKEN_ID, bob);
    }

    function test_recordActivity_unauthorized() public {
        vm.prank(frank);
        vm.expectRevert("Unauthorized");
        wr.recordActivity(TOKEN_ID);
    }

    function test_guardianRecovery_zeroNewOwner() public {
        _setupGuardiansAndConfig();

        vm.prank(bob);
        vm.expectRevert("Invalid new owner");
        wr.initiateGuardianRecovery(TOKEN_ID, address(0));
    }

    function test_timelockRecovery_cooldownNotElapsed() public {
        _setupGuardiansAndConfig();

        vm.deal(frank, 10 ether);

        // First attempt
        vm.prank(frank);
        wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);

        // Second attempt immediately — cooldown not elapsed
        vm.prank(frank);
        vm.expectRevert("Cooldown not elapsed");
        wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);
    }

    function test_reportFraud_onlyOwnerOrGuardian() public {
        _setupGuardiansAndConfig();

        vm.deal(frank, 2 ether);
        vm.prank(frank);
        uint256 requestId = wr.initiateTimelockRecovery{value: RECOVERY_BOND}(TOKEN_ID, eve);

        // Random address tries to report fraud
        address random = makeAddr("random");
        vm.prank(random);
        vm.expectRevert("Not authorized to report");
        wr.reportFraud(TOKEN_ID, requestId, keccak256("evidence"));
    }

    function test_configureRecovery_thresholdExceedsGuardians() public {
        vm.startPrank(alice);
        wr.addGuardian(TOKEN_ID, bob, "Bob");

        // Threshold 2 but only 1 active guardian
        vm.expectRevert("Threshold exceeds active guardians");
        wr.configureRecovery(TOKEN_ID, 2, 7 days, 365 days, eve, bytes32(0), false);
        vm.stopPrank();
    }
}
