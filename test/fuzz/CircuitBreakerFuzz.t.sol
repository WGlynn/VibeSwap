// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/CircuitBreaker.sol";

contract ConcreteCircuitBreakerFuzz is CircuitBreaker {
    function initialize(address _owner) external initializer {
        __Ownable_init(_owner);
    }

    function updateBreaker(bytes32 breakerType, uint256 value) external returns (bool) {
        return _updateBreaker(breakerType, value);
    }

    function breakerGatedAction(bytes32 breakerType) external whenBreakerNotTripped(breakerType) {}
    function globalGatedAction() external whenNotGloballyPaused {}
}

contract CircuitBreakerFuzzTest is Test {
    ConcreteCircuitBreakerFuzz public cb;
    address public guardian;

    function setUp() public {
        cb = new ConcreteCircuitBreakerFuzz();
        cb.initialize(address(this));

        guardian = makeAddr("guardian");
        cb.setGuardian(guardian, true);
    }

    /// @notice Breaker never trips below threshold regardless of how many updates
    function testFuzz_neverTripsBelow(uint256 threshold, uint256 value, uint8 numUpdates) public {
        threshold = bound(threshold, 100, 1e30);
        uint256 n = bound(numUpdates, 1, 50);
        // Ensure value * n < threshold
        uint256 maxPerUpdate = (threshold - 1) / n;
        if (maxPerUpdate == 0) return; // skip degenerate cases
        value = bound(value, 0, maxPerUpdate);

        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, threshold, 1 hours, 1 hours);

        bool tripped = false;
        for (uint256 i = 0; i < n; i++) {
            if (cb.updateBreaker(bType, value)) {
                tripped = true;
                break;
            }
        }

        assertFalse(tripped, "Should not trip below threshold");
    }

    /// @notice Breaker always trips at or above threshold
    function testFuzz_alwaysTripsAtThreshold(uint256 threshold) public {
        threshold = bound(threshold, 1, 1e30);

        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, threshold, 1 hours, 1 hours);

        bool tripped = cb.updateBreaker(bType, threshold);
        assertTrue(tripped, "Must trip at threshold");
    }

    /// @notice Window resets accumulator after duration
    function testFuzz_windowReset(uint256 threshold, uint256 value, uint256 windowDuration) public {
        threshold = bound(threshold, 100, 1e30);
        value = bound(value, 1, threshold - 1);
        windowDuration = bound(windowDuration, 1, 365 days);

        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, threshold, 1 hours, windowDuration);

        cb.updateBreaker(bType, value);

        // Advance past window
        vm.warp(block.timestamp + windowDuration + 1);

        // Same value again should be fresh (not accumulated)
        bool tripped = cb.updateBreaker(bType, value);
        assertFalse(tripped, "Should reset after window");
    }

    /// @notice Cooldown prevents reset until expired
    function testFuzz_cooldownPreventsReset(uint256 cooldown) public {
        cooldown = bound(cooldown, 1, 365 days);

        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 100, cooldown, 1 hours);
        cb.updateBreaker(bType, 100); // trip it

        // Try to reset at random point during cooldown
        uint256 elapsed = bound(cooldown, 0, cooldown - 1);
        vm.warp(block.timestamp + elapsed);

        vm.prank(guardian);
        vm.expectRevert(CircuitBreaker.CooldownActive.selector);
        cb.resetBreaker(bType);
    }

    /// @notice After cooldown + reset, breaker is functional again
    function testFuzz_resetAndReuse(uint256 cooldown, uint256 threshold) public {
        cooldown = bound(cooldown, 1, 30 days);
        threshold = bound(threshold, 1, 1e30);

        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, threshold, cooldown, 1 hours);
        cb.updateBreaker(bType, threshold); // trip

        vm.warp(block.timestamp + cooldown + 1);

        vm.prank(guardian);
        cb.resetBreaker(bType);

        // Should be able to trip again
        bool tripped = cb.updateBreaker(bType, threshold);
        assertTrue(tripped, "Should trip again after reset");
    }

    /// @notice Global pause blocks all gated actions
    function testFuzz_globalPauseBlocks(bool pauseState) public {
        cb.setGlobalPause(pauseState);

        if (pauseState) {
            vm.expectRevert(CircuitBreaker.GloballyPaused.selector);
            cb.globalGatedAction();
        } else {
            cb.globalGatedAction(); // should succeed
        }
    }

    /// @notice Disabled breaker never blocks
    function testFuzz_disabledNeverBlocks(uint256 value) public {
        value = bound(value, 0, type(uint128).max);

        bytes32 bType = cb.VOLUME_BREAKER();
        cb.configureBreaker(bType, 1, 1 hours, 1 hours);
        cb.disableBreaker(bType);

        bool tripped = cb.updateBreaker(bType, value);
        assertFalse(tripped, "Disabled breaker should never trip");
    }
}
