// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/CircuitBreaker.sol";

/// @notice Concrete implementation for testing the abstract CircuitBreaker
contract ConcreteCircuitBreaker is CircuitBreaker {
    bool public actionCalled;

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

    /// @notice Expose _logAnomaly for testing
    function logAnomaly(bytes32 anomalyType, uint256 value, string memory description) external {
        _logAnomaly(anomalyType, value, description);
    }

    /// @notice Expose _checkInvariants for testing
    function checkInvariants(bool[] memory conditions, string[] memory messages) external view {
        _checkInvariants(conditions, messages);
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
}
