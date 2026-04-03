// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/CircuitBreaker.sol";

/// @notice Concrete implementation for testing the abstract CircuitBreaker
contract ConcreteCircuitBreaker is CircuitBreaker {
    bool public actionCalled;

    /// @notice CB-04: small-LP threshold in bps (mirrors VibeAMM.SMALL_WITHDRAWAL_BPS_THRESHOLD)
    uint256 public constant SMALL_WITHDRAWAL_BPS_THRESHOLD = 100; // 1%

    function initialize(address _owner) external initializer {
        __Ownable_init(_owner);
    }

    /// @notice Public action gated by global pause
    function globalGatedAction() external whenNotGloballyPaused {
        actionCalled = true;
    }

    /// @notice Public action gated by per-function pause
    function functionGatedAction() external whenFunctionNotPaused {
        actionCalled = true;
    }

    /// @notice Public action gated by specific breaker
    function breakerGatedAction(bytes32 breakerType) external whenBreakerNotTripped(breakerType) {
        actionCalled = true;
    }

    /// @notice Expose _updateBreaker for testing
    function updateBreaker(bytes32 breakerType, uint256 value) external returns (bool) {
        return _updateBreaker(breakerType, value);
    }

    /// @notice CB-04: withdrawal action with small-LP exemption logic (mirrors VibeAMM.removeLiquidity)
    /// @param withdrawalBps This withdrawal's share of total pool liquidity in basis points
    function withdrawalWithExemption(uint256 withdrawalBps) external returns (bool blocked) {
        bool breakerTripped = _updateBreaker(WITHDRAWAL_BREAKER, withdrawalBps);
        if (breakerTripped && withdrawalBps >= SMALL_WITHDRAWAL_BPS_THRESHOLD) {
            return true; // would revert in VibeAMM; return true here so tests can assert
        }
        actionCalled = true;
        return false;
    }

    /// @notice Expose _logAnomaly for testing
    function logAnomaly(bytes32 anomalyType, uint256 value, string memory description) external {
        _logAnomaly(anomalyType, value, description);
    }

    /// @notice Expose _checkInvariants for testing
    function checkInvariants(bool[] memory conditions, string[] memory messages) external view {
        _checkInvariants(conditions, messages);
    }

    /// @notice Expose _checkBreaker for CB-05 testing (simulates the whenBreakerNotTripped modifier path)
    function checkBreaker(bytes32 breakerType) external {
        _checkBreaker(breakerType);
    }

    /// @notice Expose raw BreakerState fields for assertion
    function getWindowValue(bytes32 breakerType) external view returns (uint256) {
        return breakerStates[breakerType].windowValue;
    }

    function getWindowStart(bytes32 breakerType) external view returns (uint256) {
        return breakerStates[breakerType].windowStart;
    }

}

contract CircuitBreakerTest is Test {
    ConcreteCircuitBreaker public cb;

    address public owner;
    address public guardian;
    address public alice;

    event GlobalPauseChanged(bool paused, address indexed by);
    event FunctionPauseChanged(bytes4 indexed selector, bool paused, address indexed by);
    event GuardianUpdated(address indexed guardian, bool status);
    event BreakerConfigured(bytes32 indexed breakerType, uint256 threshold, uint256 cooldown);
    event BreakerTripped(bytes32 indexed breakerType, uint256 value, uint256 threshold);
    event BreakerReset(bytes32 indexed breakerType, address indexed by);
    event AnomalyDetected(bytes32 indexed anomalyType, uint256 value, string description);

    function setUp() public {
        owner = address(this);
        guardian = makeAddr("guardian");
        alice = makeAddr("alice");

        cb = new ConcreteCircuitBreaker();
        cb.initialize(owner);

        cb.setGuardian(guardian, true);
    }

    // ============ Global Pause ============

    function test_globalPause_default() public view {
        assertFalse(cb.globalPaused());
    }

    function test_globalPause_guardianCanPause() public {
        vm.prank(guardian);
        vm.expectEmit(false, true, false, true);
        emit GlobalPauseChanged(true, guardian);
        cb.setGlobalPause(true);
        assertTrue(cb.globalPaused());
    }

    function test_globalPause_ownerCanPause() public {
        cb.setGlobalPause(true);
        assertTrue(cb.globalPaused());
    }

    function test_globalPause_blocksGatedAction() public {
        cb.setGlobalPause(true);
        vm.expectRevert(CircuitBreaker.GloballyPaused.selector);
        cb.globalGatedAction();
    }

    function test_globalPause_unblockAfterUnpause() public {
        cb.setGlobalPause(true);
        cb.setGlobalPause(false);
        cb.globalGatedAction();
        assertTrue(cb.actionCalled());
    }

    function test_globalPause_nonGuardianReverts() public {
        vm.prank(alice);
        vm.expectRevert(CircuitBreaker.NotGuardian.selector);
        cb.setGlobalPause(true);
    }

    function test_emergencyPauseAll() public {
        vm.prank(guardian);
        cb.emergencyPauseAll();
        assertTrue(cb.globalPaused());
    }

    function test_isOperational() public {
        assertTrue(cb.isOperational());
        cb.setGlobalPause(true);
        assertFalse(cb.isOperational());
    }

    // ============ Function Pause ============

    function test_functionPause_default() public view {
        assertFalse(cb.functionPaused(ConcreteCircuitBreaker.functionGatedAction.selector));
    }

    function test_functionPause_guardianCanPause() public {
        bytes4 sel = ConcreteCircuitBreaker.functionGatedAction.selector;
        vm.prank(guardian);
        cb.setFunctionPause(sel, true);
        assertTrue(cb.functionPaused(sel));
    }

    function test_functionPause_blocksGatedAction() public {
        bytes4 sel = ConcreteCircuitBreaker.functionGatedAction.selector;
        cb.setFunctionPause(sel, true);
        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.FunctionPaused.selector, sel));
        cb.functionGatedAction();
    }

    function test_functionPause_otherFunctionsUnaffected() public {
        bytes4 sel = ConcreteCircuitBreaker.functionGatedAction.selector;
        cb.setFunctionPause(sel, true);
        // globalGatedAction should still work
        cb.globalGatedAction();
        assertTrue(cb.actionCalled());
    }

    function test_functionPause_unpause() public {
        bytes4 sel = ConcreteCircuitBreaker.functionGatedAction.selector;
        cb.setFunctionPause(sel, true);
        cb.setFunctionPause(sel, false);
        cb.functionGatedAction();
        assertTrue(cb.actionCalled());
    }

    // ============ Guardian Management ============

    function test_setGuardian_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        cb.setGuardian(alice, true);
    }

    function test_setGuardian_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit GuardianUpdated(alice, true);
        cb.setGuardian(alice, true);
        assertTrue(cb.guardians(alice));
    }

    function test_setGuardian_revoke() public {
        cb.setGuardian(alice, true);
        cb.setGuardian(alice, false);
        assertFalse(cb.guardians(alice));
    }

    // ============ Breaker Configuration ============

    function test_configureBreaker() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        vm.expectEmit(true, false, false, true);
        emit BreakerConfigured(bType, 1000e18, 1 hours);
        cb.configureBreaker(bType, 1000e18, 1 hours, 1 hours);

        (bool enabled, uint256 threshold, uint256 cooldown, uint256 window) = cb.breakerConfigs(bType);
        assertTrue(enabled);
        assertEq(threshold, 1000e18);
        assertEq(cooldown, 1 hours);
        assertEq(window, 1 hours);
    }

    function test_configureBreaker_onlyOwner() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        vm.prank(alice);
        vm.expectRevert();
        cb.configureBreaker(bType, 1000e18, 1 hours, 1 hours);
    }

    function test_disableBreaker() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 1000e18, 1 hours, 1 hours);
        cb.disableBreaker(bType);

        (bool enabled,,,) = cb.breakerConfigs(bType);
        assertFalse(enabled);
    }

    // ============ Breaker Tripping ============

    function test_updateBreaker_noTripBelowThreshold() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 1000e18, 1 hours, 1 hours);

        bool tripped = cb.updateBreaker(bType, 500e18);
        assertFalse(tripped);
    }

    function test_updateBreaker_tripAtThreshold() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 1000e18, 1 hours, 1 hours);

        vm.expectEmit(true, false, false, true);
        emit BreakerTripped(bType, 1000e18, 1000e18);
        bool tripped = cb.updateBreaker(bType, 1000e18);
        assertTrue(tripped);
    }

    function test_updateBreaker_accumulatesInWindow() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 1000e18, 1 hours, 1 hours);

        cb.updateBreaker(bType, 400e18);
        cb.updateBreaker(bType, 400e18);
        bool tripped = cb.updateBreaker(bType, 200e18);
        assertTrue(tripped);
    }

    function test_updateBreaker_windowReset() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 1000e18, 1 hours, 1 hours);

        cb.updateBreaker(bType, 800e18);

        // Advance past window
        vm.warp(block.timestamp + 2 hours);

        // Window resets, so 800 again doesn't trip
        bool tripped = cb.updateBreaker(bType, 800e18);
        assertFalse(tripped);
    }

    function test_updateBreaker_disabledNeverTrips() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        // Not configured = not enabled
        bool tripped = cb.updateBreaker(bType, type(uint256).max);
        assertFalse(tripped);
    }

    function test_updateBreaker_alreadyTrippedReturnsTrue() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 100, 1 hours, 1 hours);

        cb.updateBreaker(bType, 100);
        bool tripped = cb.updateBreaker(bType, 1);
        assertTrue(tripped);
    }

    function test_breakerGatedAction_blockedWhenTripped() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 100, 1 hours, 1 hours);
        cb.updateBreaker(bType, 100);

        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, bType));
        cb.breakerGatedAction(bType);
    }

    function test_breakerGatedAction_passesAfterCooldown() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 100, 1 hours, 1 hours);
        cb.updateBreaker(bType, 100);

        // Advance past cooldown
        vm.warp(block.timestamp + 1 hours + 1);
        cb.breakerGatedAction(bType);
        assertTrue(cb.actionCalled());
    }

    // ============ Breaker Reset ============

    function test_resetBreaker_afterCooldown() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 100, 1 hours, 1 hours);
        cb.updateBreaker(bType, 100);

        vm.warp(block.timestamp + 1 hours + 1);

        vm.prank(guardian);
        vm.expectEmit(true, true, false, true);
        emit BreakerReset(bType, guardian);
        cb.resetBreaker(bType);

        (bool tripped,,,) = cb.breakerStates(bType);
        assertFalse(tripped);
    }

    function test_resetBreaker_duringCooldownReverts() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 100, 1 hours, 1 hours);
        cb.updateBreaker(bType, 100);

        vm.prank(guardian);
        vm.expectRevert(CircuitBreaker.CooldownActive.selector);
        cb.resetBreaker(bType);
    }

    function test_resetBreaker_nonGuardianReverts() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        vm.prank(alice);
        vm.expectRevert(CircuitBreaker.NotGuardian.selector);
        cb.resetBreaker(bType);
    }

    // ============ Breaker Status ============

    function test_getBreakerStatus_initial() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        (bool enabled, bool tripped, uint256 currentValue, uint256 threshold, uint256 cooldownRemaining) =
            cb.getBreakerStatus(bType);

        assertFalse(enabled);
        assertFalse(tripped);
        assertEq(currentValue, 0);
        assertEq(threshold, 0);
        assertEq(cooldownRemaining, 0);
    }

    function test_getBreakerStatus_configured() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 1000e18, 2 hours, 1 hours);

        (bool enabled, bool tripped,, uint256 threshold,) = cb.getBreakerStatus(bType);
        assertTrue(enabled);
        assertFalse(tripped);
        assertEq(threshold, 1000e18);
    }

    function test_getBreakerStatus_trippedWithCooldown() public {
        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 100, 2 hours, 1 hours);
        cb.updateBreaker(bType, 100);

        (, bool tripped,,, uint256 cooldownRemaining) = cb.getBreakerStatus(bType);
        assertTrue(tripped);
        assertEq(cooldownRemaining, 2 hours);
    }

    // ============ Log Anomaly ============

    function test_logAnomaly_emitsEvent() public {
        bytes32 aType = keccak256("SUSPICIOUS");
        vm.expectEmit(true, false, false, true);
        emit AnomalyDetected(aType, 42, "strange value");
        cb.logAnomaly(aType, 42, "strange value");
    }

    // ============ Check Invariants ============

    function test_checkInvariants_allPass() public view {
        bool[] memory conditions = new bool[](2);
        conditions[0] = true;
        conditions[1] = true;
        string[] memory messages = new string[](2);
        messages[0] = "a";
        messages[1] = "b";
        cb.checkInvariants(conditions, messages);
    }

    function test_checkInvariants_failReverts() public {
        bool[] memory conditions = new bool[](2);
        conditions[0] = true;
        conditions[1] = false;
        string[] memory messages = new string[](2);
        messages[0] = "ok";
        messages[1] = "bad";
        vm.expectRevert(bytes("bad"));
        cb.checkInvariants(conditions, messages);
    }

    function test_checkInvariants_lengthMismatch() public {
        bool[] memory conditions = new bool[](1);
        conditions[0] = true;
        string[] memory messages = new string[](2);
        messages[0] = "a";
        messages[1] = "b";
        vm.expectRevert(bytes("Length mismatch"));
        cb.checkInvariants(conditions, messages);
    }

    // ============ Breaker Constants ============

    function test_breakerConstants() public view {
        assertEq(cb.VOLUME_BREAKER(), keccak256("VOLUME_BREAKER"));
        assertEq(cb.PRICE_BREAKER(), keccak256("PRICE_BREAKER"));
        assertEq(cb.WITHDRAWAL_BREAKER(), keccak256("WITHDRAWAL_BREAKER"));
        assertEq(cb.LOSS_BREAKER(), keccak256("LOSS_BREAKER"));
        assertEq(cb.TRUE_PRICE_BREAKER(), keccak256("TRUE_PRICE_BREAKER"));
    }

    // ============ Multiple Breakers Independent ============

    function test_multipleBreakers_independent() public {
        bytes32 vol = cb.VOLUME_BREAKER();
        bytes32 price = cb.PRICE_BREAKER();

        cb.configureBreaker(vol, 100, 1 hours, 1 hours);
        cb.configureBreaker(price, 50, 1 hours, 1 hours);

        cb.updateBreaker(vol, 100); // trips volume
        bool priceTripped = cb.updateBreaker(price, 30); // price not tripped

        assertFalse(priceTripped);

        // Volume breaker blocks its action
        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, vol));
        cb.breakerGatedAction(vol);

        // Price breaker still allows its action
        cb.breakerGatedAction(price);
    }

    // ============ CB-04: Whale LP Griefing Fix ============

    // Configure WITHDRAWAL_BREAKER with a 25% threshold (2500 bps), 2h cooldown, 1h window —
    // matching VibeAMM's production config.
    function _setupWithdrawalBreaker() internal {
        cb.configureBreaker(cb.WITHDRAWAL_BREAKER(), 2500, 2 hours, 1 hours);
    }

    /// A large withdrawal (>= 1% of pool) that trips the breaker is blocked.
    function test_cb04_largeWithdrawal_tripsAndBlocks() public {
        _setupWithdrawalBreaker();

        // 2500 bps (25%) trips the breaker; withdrawal is also >= 100 bps so it should be blocked
        bool blocked = cb.withdrawalWithExemption(2500);
        assertTrue(blocked, "Large withdrawal that trips breaker should be blocked");
        assertFalse(cb.actionCalled(), "actionCalled must be false when blocked");
    }

    /// A small withdrawal (< 1% of pool) is exempt even when the breaker is tripped.
    function test_cb04_smallWithdrawal_exemptWhenBreakerTripped() public {
        _setupWithdrawalBreaker();

        // First: whale trips breaker with a 2500 bps withdrawal
        cb.withdrawalWithExemption(2500);

        // Verify breaker is tripped
        (, bool tripped,,,) = cb.getBreakerStatus(cb.WITHDRAWAL_BREAKER());
        assertTrue(tripped, "Breaker must be tripped after whale withdrawal");

        // Now: small LP withdraws 50 bps (0.5% of pool) — below the 100 bps threshold
        bool blocked = cb.withdrawalWithExemption(50);
        assertFalse(blocked, "Small withdrawal must not be blocked even when breaker is tripped");
        assertTrue(cb.actionCalled(), "actionCalled must be true - small LP succeeded");
    }

    /// A withdrawal exactly at the threshold (100 bps) is NOT exempt — boundary check.
    function test_cb04_atThreshold_notExempt() public {
        _setupWithdrawalBreaker();

        // Trip the breaker first
        cb.withdrawalWithExemption(2500);

        // 100 bps exactly equals SMALL_WITHDRAWAL_BPS_THRESHOLD → not exempt
        bool blocked = cb.withdrawalWithExemption(100);
        assertTrue(blocked, "Withdrawal at threshold boundary should be blocked");
    }

    /// A withdrawal one bps below the threshold (99 bps) IS exempt — other boundary check.
    function test_cb04_belowThreshold_exempt() public {
        _setupWithdrawalBreaker();

        // Trip the breaker
        cb.withdrawalWithExemption(2500);

        // 99 bps is below 100 bps threshold → exempt
        bool blocked = cb.withdrawalWithExemption(99);
        assertFalse(blocked, "Withdrawal just below threshold should pass through");
    }

    /// After cooldown expires, all withdrawals work normally again.
    function test_cb04_afterCooldown_largeWithdrawalsResume() public {
        _setupWithdrawalBreaker();

        // Trip breaker
        cb.withdrawalWithExemption(2500);

        // Advance past cooldown
        vm.warp(block.timestamp + 2 hours + 1);

        // Large withdrawal should now succeed (breaker auto-resets via _updateBreaker)
        bool blocked = cb.withdrawalWithExemption(500);
        assertFalse(blocked, "Large withdrawal should succeed after cooldown expires");
        assertTrue(cb.actionCalled());
    }

    /// Without breaker tripped, large withdrawals proceed normally (no false positives).
    function test_cb04_noFalsePositive_largeBelowThreshold() public {
        _setupWithdrawalBreaker();

        // 500 bps (5%) — well below 2500 bps trip threshold, breaker not tripped
        bool blocked = cb.withdrawalWithExemption(500);
        assertFalse(blocked, "Large withdrawal that doesn't trip breaker should not be blocked");
        assertTrue(cb.actionCalled());
    }

    // ============ CB-05: Stale Window Re-Trip ============
    // Finding: after cooldown expires the breaker auto-resets, but if windowValue is
    // not cleared the next small trade can immediately re-trip using stale accumulated
    // volume. The fix zeroes windowValue and resets windowStart in both _checkBreaker
    // and _updateBreaker when auto-resetting after cooldown.

    function _setupVolumeBreaker() internal {
        cb.configureBreaker(cb.VOLUME_BREAKER(), 1000 ether, 1 hours, 10 minutes);
    }

    /// @dev Core CB-05 regression: trip the breaker, wait for cooldown, then call
    ///      _checkBreaker (the modifier path). windowValue MUST be zero after auto-reset,
    ///      not THRESHOLD. If the bug were present, windowValue would remain at THRESHOLD
    ///      and the next tiny trade would re-trip.
    function test_cb05_checkBreaker_clearsWindowValueOnAutoReset() public {
        _setupVolumeBreaker();
        bytes32 vol = cb.VOLUME_BREAKER();

        // Trip: accumulate exactly at threshold
        cb.updateBreaker(vol, 1000 ether);

        // Confirm tripped and windowValue is at threshold
        (, bool trippedBefore,,,) = cb.getBreakerStatus(vol);
        assertTrue(trippedBefore, "Breaker must be tripped");
        assertEq(cb.getWindowValue(vol), 1000 ether, "windowValue should equal threshold at trip");

        // Advance past cooldown
        vm.warp(block.timestamp + 1 hours + 1);

        // Simulate the whenBreakerNotTripped modifier calling _checkBreaker
        cb.checkBreaker(vol);

        // CB-05 fix: windowValue must be zeroed, not left at the old threshold
        assertEq(cb.getWindowValue(vol), 0, "CB-05: windowValue MUST be zeroed on auto-reset via _checkBreaker");
        assertEq(cb.getWindowStart(vol), block.timestamp, "windowStart must be refreshed to now");

        (, bool trippedAfter,,,) = cb.getBreakerStatus(vol);
        assertFalse(trippedAfter, "Breaker must be clear after cooldown");
    }

    /// @dev After _checkBreaker clears stale state, a small trade must NOT re-trip.
    ///      This is the exact user-visible symptom of CB-05.
    function test_cb05_smallTradeAfterCheckBreakerReset_doesNotRetrip() public {
        _setupVolumeBreaker();
        bytes32 vol = cb.VOLUME_BREAKER();

        // Trip
        cb.updateBreaker(vol, 1000 ether);

        // Expire cooldown, simulate modifier gate
        vm.warp(block.timestamp + 1 hours + 1);
        cb.checkBreaker(vol);

        // A 1% trade should NOT re-trip a freshly reset breaker
        bool reTripped = cb.updateBreaker(vol, 10 ether);
        assertFalse(reTripped, "CB-05: tiny trade must not re-trip after _checkBreaker auto-reset");
        assertEq(cb.getWindowValue(vol), 10 ether, "windowValue must only reflect new trade");
    }

    /// @dev _updateBreaker also auto-resets on cooldown expiry. Verify it too clears
    ///      windowValue (the TRP-R24-CB01 code path, confirmed intact for CB-05).
    function test_cb05_updateBreaker_clearsWindowValueOnAutoReset() public {
        _setupVolumeBreaker();
        bytes32 vol = cb.VOLUME_BREAKER();

        cb.updateBreaker(vol, 1000 ether);

        vm.warp(block.timestamp + 1 hours + 1);

        // Small value — if bug were present (windowValue not cleared), this would re-trip
        bool reTripped = cb.updateBreaker(vol, 1 ether);
        assertFalse(reTripped, "CB-05: _updateBreaker auto-reset must clear old windowValue");
        assertEq(cb.getWindowValue(vol), 1 ether, "windowValue must only be the new trade amount");
    }

    /// @dev Verify the breaker blocks during cooldown and auto-clears exactly at expiry.
    ///      The condition is `block.timestamp < trippedAt + cooldownPeriod`, so equality
    ///      means the cooldown has expired and auto-reset triggers.
    function test_cb05_checkBreaker_revertsInCooldown_clearsAtExpiry() public {
        _setupVolumeBreaker();
        bytes32 vol = cb.VOLUME_BREAKER();
        uint256 tripTime = block.timestamp;

        cb.updateBreaker(vol, 1000 ether);

        // One second BEFORE cooldown ends: timestamp < trippedAt + cooldown → still locked
        vm.warp(tripTime + 1 hours - 1);
        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, vol));
        cb.checkBreaker(vol);

        // At exactly trippedAt + cooldown: timestamp == trippedAt + cooldown → NOT < → auto-reset
        vm.warp(tripTime + 1 hours);
        cb.checkBreaker(vol); // must not revert

        assertEq(cb.getWindowValue(vol), 0, "windowValue must be zero when cooldown expires");
    }

    /// @dev A fresh threshold-sized trade after reset should legitimately re-trip
    ///      (this is correct behavior — threshold is freshly reached with new data).
    function test_cb05_freshThresholdTrade_legitimatelyRetrips() public {
        _setupVolumeBreaker();
        bytes32 vol = cb.VOLUME_BREAKER();

        cb.updateBreaker(vol, 1000 ether);
        vm.warp(block.timestamp + 1 hours + 1);

        // After reset, a brand-new full-threshold trade should trip (this is correct)
        cb.checkBreaker(vol);
        bool reTripped = cb.updateBreaker(vol, 1000 ether);
        assertTrue(reTripped, "A fresh threshold-sized trade must still trip after reset");
    }

    /// @dev Multiple trip-reset cycles: each cycle must produce a clean slate.
    function test_cb05_multipleCycles_eachCycleCleansWindow() public {
        _setupVolumeBreaker();
        bytes32 vol = cb.VOLUME_BREAKER();

        for (uint256 i = 0; i < 3; i++) {
            // Trip
            cb.updateBreaker(vol, 1000 ether);
            (, bool tripped,,,) = cb.getBreakerStatus(vol);
            assertTrue(tripped, "Should be tripped at cycle start");

            // Expire and auto-reset via modifier path
            vm.warp(block.timestamp + 1 hours + 1);
            cb.checkBreaker(vol);

            // Verify clean slate after each reset
            assertEq(cb.getWindowValue(vol), 0, "windowValue must be 0 at cycle reset");
            (, bool cleared,,,) = cb.getBreakerStatus(vol);
            assertFalse(cleared, "Breaker must be clear after each cycle reset");
        }
    }

    /// @dev Confirm that TRP-R24-CB03 validation is intact: configuring with zero
    ///      threshold/cooldown/window reverts. This prevents pathological configs
    ///      that could interact badly with CB-05's window-clearing logic.
    function test_cb05_configValidation_preventsZeroParams() public {
        bytes32 vol = cb.VOLUME_BREAKER();

        vm.expectRevert("Threshold must be > 0");
        cb.configureBreaker(vol, 0, 1 hours, 10 minutes);

        vm.expectRevert("Cooldown must be > 0");
        cb.configureBreaker(vol, 1000 ether, 0, 10 minutes);

        vm.expectRevert("Window must be > 0");
        cb.configureBreaker(vol, 1000 ether, 1 hours, 0);
    }
}
