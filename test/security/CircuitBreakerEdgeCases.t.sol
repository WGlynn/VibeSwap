// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/CircuitBreaker.sol";

/// @notice Concrete harness exposing CircuitBreaker internals for edge-case testing
contract CBHarness is CircuitBreaker {
    function initialize(address _owner) external initializer {
        __Ownable_init(_owner);
    }

    function gatedAction(bytes32 breakerType) external whenBreakerNotTripped(breakerType) {}

    function updateBreaker(bytes32 breakerType, uint256 value) external returns (bool) {
        return _updateBreaker(breakerType, value);
    }
}

/// @title CircuitBreakerEdgeCases
/// @notice Edge-case security tests for volume, price, and withdrawal breakers
contract CircuitBreakerEdgeCases is Test {
    CBHarness public cb;

    address public owner;
    address public guardian;

    // Breaker type shortcuts
    bytes32 internal VOL;
    bytes32 internal PRICE;
    bytes32 internal WDRAW;

    // Thresholds matching VibeSwap spec
    uint256 constant VOLUME_THRESHOLD = 100_000e18;     // 100K tokens/window
    uint256 constant PRICE_THRESHOLD = 500;             // 5% in basis points
    uint256 constant WITHDRAWAL_THRESHOLD = 50_000e18;  // 50K tokens/window
    uint256 constant COOLDOWN = 1 hours;
    uint256 constant WINDOW = 1 hours;

    event BreakerTripped(bytes32 indexed breakerType, uint256 value, uint256 threshold);
    event BreakerReset(bytes32 indexed breakerType, address indexed by);

    function setUp() public {
        owner = address(this);
        guardian = makeAddr("guardian");

        cb = new CBHarness();
        cb.initialize(owner);
        cb.setGuardian(guardian, true);

        VOL = cb.VOLUME_BREAKER();
        PRICE = cb.PRICE_BREAKER();
        WDRAW = cb.WITHDRAWAL_BREAKER();

        // Configure all three breakers
        cb.configureBreaker(VOL, VOLUME_THRESHOLD, COOLDOWN, WINDOW);
        cb.configureBreaker(PRICE, PRICE_THRESHOLD, COOLDOWN, WINDOW);
        cb.configureBreaker(WDRAW, WITHDRAWAL_THRESHOLD, COOLDOWN, WINDOW);
    }

    // ============ 1. Volume Threshold Exceeded ============

    function test_volumeBreaker_tripsOnExceed() public {
        vm.expectEmit(true, false, false, true);
        emit BreakerTripped(VOL, VOLUME_THRESHOLD, VOLUME_THRESHOLD);

        bool tripped = cb.updateBreaker(VOL, VOLUME_THRESHOLD);
        assertTrue(tripped, "volume breaker should trip at threshold");

        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, VOL));
        cb.gatedAction(VOL);
    }

    function test_volumeBreaker_tripsOnAccumulation() public {
        cb.updateBreaker(VOL, VOLUME_THRESHOLD / 2);
        bool tripped = cb.updateBreaker(VOL, VOLUME_THRESHOLD / 2);
        assertTrue(tripped, "accumulated volume should trip breaker");
    }

    // ============ 2. Price Deviation Exceeds Max (5%) ============

    function test_priceBreaker_tripsOnDeviation() public {
        vm.expectEmit(true, false, false, true);
        emit BreakerTripped(PRICE, PRICE_THRESHOLD, PRICE_THRESHOLD);

        bool tripped = cb.updateBreaker(PRICE, PRICE_THRESHOLD);
        assertTrue(tripped, "price breaker should trip at 5% deviation");
    }

    function test_priceBreaker_tripsOnExcessiveDeviation() public {
        bool tripped = cb.updateBreaker(PRICE, PRICE_THRESHOLD + 100);
        assertTrue(tripped, "price breaker should trip above 5%");
    }

    // ============ 3. Withdrawal Rate Too High ============

    function test_withdrawalBreaker_tripsOnHighRate() public {
        vm.expectEmit(true, false, false, true);
        emit BreakerTripped(WDRAW, WITHDRAWAL_THRESHOLD, WITHDRAWAL_THRESHOLD);

        bool tripped = cb.updateBreaker(WDRAW, WITHDRAWAL_THRESHOLD);
        assertTrue(tripped, "withdrawal breaker should trip at threshold");

        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, WDRAW));
        cb.gatedAction(WDRAW);
    }

    // ============ 4. Normal Activity Below Thresholds ============

    function test_normalActivity_doesNotTrip() public {
        // All values well below thresholds
        assertFalse(cb.updateBreaker(VOL, VOLUME_THRESHOLD / 10));
        assertFalse(cb.updateBreaker(PRICE, PRICE_THRESHOLD / 10));
        assertFalse(cb.updateBreaker(WDRAW, WITHDRAWAL_THRESHOLD / 10));

        // All gated actions still pass
        cb.gatedAction(VOL);
        cb.gatedAction(PRICE);
        cb.gatedAction(WDRAW);
    }

    function test_normalActivity_justBelowThreshold() public {
        assertFalse(cb.updateBreaker(VOL, VOLUME_THRESHOLD - 1));
        cb.gatedAction(VOL);
    }

    // ============ 5. Cooldown Reset ============

    function test_cooldown_breakerResetsAfterPeriod() public {
        cb.updateBreaker(VOL, VOLUME_THRESHOLD);

        // Still tripped during cooldown
        vm.warp(block.timestamp + COOLDOWN - 1);
        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, VOL));
        cb.gatedAction(VOL);

        // Passes after cooldown expires
        vm.warp(block.timestamp + 2);
        cb.gatedAction(VOL);
    }

    function test_cooldown_manualResetBlockedDuringCooldown() public {
        cb.updateBreaker(VOL, VOLUME_THRESHOLD);

        vm.prank(guardian);
        vm.expectRevert(CircuitBreaker.CooldownActive.selector);
        cb.resetBreaker(VOL);
    }

    function test_cooldown_manualResetSucceedsAfter() public {
        cb.updateBreaker(VOL, VOLUME_THRESHOLD);
        vm.warp(block.timestamp + COOLDOWN + 1);

        vm.prank(guardian);
        vm.expectEmit(true, true, false, true);
        emit BreakerReset(VOL, guardian);
        cb.resetBreaker(VOL);

        // Confirm state is clean
        (, bool tripped,,,) = cb.getBreakerStatus(VOL);
        assertFalse(tripped);
    }

    // ============ 6. Multiple Breakers Active Simultaneously ============

    function test_multipleBreakers_allTripIndependently() public {
        cb.updateBreaker(VOL, VOLUME_THRESHOLD);
        cb.updateBreaker(PRICE, PRICE_THRESHOLD);
        cb.updateBreaker(WDRAW, WITHDRAWAL_THRESHOLD);

        // All three block their gated actions
        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, VOL));
        cb.gatedAction(VOL);

        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, PRICE));
        cb.gatedAction(PRICE);

        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, WDRAW));
        cb.gatedAction(WDRAW);
    }

    function test_multipleBreakers_resetOneOthersRemain() public {
        // Trip volume at t=0
        cb.updateBreaker(VOL, VOLUME_THRESHOLD);

        // Trip price 30 minutes later so its cooldown expires later
        vm.warp(block.timestamp + 30 minutes);
        cb.updateBreaker(PRICE, PRICE_THRESHOLD);

        // Warp past volume cooldown (1h from trip) but NOT past price cooldown (1h from 30min later)
        vm.warp(block.timestamp + 31 minutes);

        // Reset volume (cooldown expired)
        vm.prank(guardian);
        cb.resetBreaker(VOL);

        // Volume passes (reset), price still blocked (cooldown still active)
        cb.gatedAction(VOL);

        vm.expectRevert(abi.encodeWithSelector(CircuitBreaker.BreakerTrippedError.selector, PRICE));
        cb.gatedAction(PRICE);
    }

    // ============ 7. Admin Manual Trip/Reset ============

    function test_admin_manualTripViaEmergencyPause() public {
        cb.emergencyPauseAll();
        assertTrue(cb.globalPaused());
    }

    function test_admin_manualResetByGuardian() public {
        cb.updateBreaker(VOL, VOLUME_THRESHOLD);
        vm.warp(block.timestamp + COOLDOWN + 1);

        vm.prank(guardian);
        cb.resetBreaker(VOL);

        cb.gatedAction(VOL);
    }

    function test_admin_ownerCanResetBreaker() public {
        cb.updateBreaker(VOL, VOLUME_THRESHOLD);
        vm.warp(block.timestamp + COOLDOWN + 1);

        // Owner is also authorized (onlyGuardian allows owner)
        cb.resetBreaker(VOL);
        cb.gatedAction(VOL);
    }

    function test_admin_nonGuardianCannotReset() public {
        address nobody = makeAddr("nobody");
        cb.updateBreaker(VOL, VOLUME_THRESHOLD);
        vm.warp(block.timestamp + COOLDOWN + 1);

        vm.prank(nobody);
        vm.expectRevert(CircuitBreaker.NotGuardian.selector);
        cb.resetBreaker(VOL);
    }
}
