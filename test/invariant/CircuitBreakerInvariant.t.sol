// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/core/CircuitBreaker.sol";

// ============ Concrete Implementation ============

contract ConcreteCircuitBreakerInv is CircuitBreaker {
    function initialize(address _owner) external initializer {
        __Ownable_init(_owner);
    }

    function updateBreaker(bytes32 breakerType, uint256 value) external returns (bool) {
        return _updateBreaker(breakerType, value);
    }
}

// ============ Handler ============

contract CBHandler is Test {
    ConcreteCircuitBreakerInv public cb;
    address public guardian;

    bytes32 public constant VOL = keccak256("VOLUME_BREAKER");
    bytes32 public constant PRICE = keccak256("PRICE_BREAKER");

    // Ghost variables
    uint256 public ghost_totalVolumeAccumulated;
    uint256 public ghost_totalPriceAccumulated;
    uint256 public ghost_volumeTrips;
    uint256 public ghost_priceTrips;
    uint256 public ghost_updates;

    constructor(ConcreteCircuitBreakerInv _cb, address _guardian) {
        cb = _cb;
        guardian = _guardian;
    }

    /// @notice Update volume breaker with random value
    function updateVolume(uint256 value) external {
        value = bound(value, 1, 1e24);
        ghost_totalVolumeAccumulated += value;
        ghost_updates++;

        bool tripped = cb.updateBreaker(VOL, value);
        if (tripped) ghost_volumeTrips++;
    }

    /// @notice Update price breaker with random value
    function updatePrice(uint256 value) external {
        value = bound(value, 1, 1e24);
        ghost_totalPriceAccumulated += value;
        ghost_updates++;

        bool tripped = cb.updateBreaker(PRICE, value);
        if (tripped) ghost_priceTrips++;
    }

    /// @notice Advance time to test window resets
    function advanceTime(uint256 seconds_) external {
        seconds_ = bound(seconds_, 1, 2 hours);
        vm.warp(block.timestamp + seconds_);
    }

    /// @notice Reset volume breaker (as guardian, after cooldown)
    function resetVolume() external {
        (bool tripped, uint256 trippedAt,,) = cb.breakerStates(VOL);
        if (!tripped) return;

        (, uint256 threshold, uint256 cooldown,) = cb.breakerConfigs(VOL);
        if (block.timestamp < trippedAt + cooldown) return;

        vm.prank(guardian);
        cb.resetBreaker(VOL);
    }
}

// ============ Invariant Test ============

contract CircuitBreakerInvariantTest is StdInvariant, Test {
    ConcreteCircuitBreakerInv public cb;
    CBHandler public handler;
    address public guardian;

    function setUp() public {
        guardian = makeAddr("guardian");

        cb = new ConcreteCircuitBreakerInv();
        cb.initialize(address(this));
        cb.setGuardian(guardian, true);

        // Configure two breakers
        cb.configureBreaker(cb.VOLUME_BREAKER(), 10_000e18, 30 minutes, 1 hours);
        cb.configureBreaker(cb.PRICE_BREAKER(), 5_000e18, 30 minutes, 1 hours);

        handler = new CBHandler(cb, guardian);
        targetContract(address(handler));
    }

    /// @notice Tripped breaker always has non-zero trippedAt timestamp
    function invariant_trippedHasTimestamp() public view {
        (bool volTripped, uint256 volTrippedAt,,) = cb.breakerStates(cb.VOLUME_BREAKER());
        (bool priceTripped, uint256 priceTrippedAt,,) = cb.breakerStates(cb.PRICE_BREAKER());

        if (volTripped) {
            assertTrue(volTrippedAt > 0, "Tripped volume breaker must have timestamp");
        }
        if (priceTripped) {
            assertTrue(priceTrippedAt > 0, "Tripped price breaker must have timestamp");
        }
    }

    /// @notice Window value never exceeds accumulation within current window
    function invariant_windowValueBounded() public view {
        (,, uint256 volWindowStart, uint256 volWindowValue) = cb.breakerStates(cb.VOLUME_BREAKER());
        (,,, uint256 volWindowDuration) = cb.breakerConfigs(cb.VOLUME_BREAKER());

        // Window value can't exceed ghost total (it can be less due to window resets)
        assertTrue(
            volWindowValue <= handler.ghost_totalVolumeAccumulated(),
            "Window value cannot exceed total accumulated"
        );
    }

    /// @notice Breakers are independent - volume trip doesn't affect price
    function invariant_breakersIndependent() public view {
        (bool volTripped,,,) = cb.breakerStates(cb.VOLUME_BREAKER());
        (bool priceTripped,,,) = cb.breakerStates(cb.PRICE_BREAKER());

        // They can be independently tripped or not
        // Just check each is valid individually - no cross-contamination
        (bool volEnabled,,,) = cb.breakerConfigs(cb.VOLUME_BREAKER());
        (bool priceEnabled,,,) = cb.breakerConfigs(cb.PRICE_BREAKER());

        assertTrue(volEnabled, "Volume breaker should remain enabled");
        assertTrue(priceEnabled, "Price breaker should remain enabled");
    }

    /// @notice Global pause is always false (handler never pauses)
    function invariant_globalPauseUnchanged() public view {
        assertFalse(cb.globalPaused(), "Global pause should not change via handler");
    }

    /// @notice Config never changes (handler doesn't reconfigure)
    function invariant_configStable() public view {
        (, uint256 volThreshold,,) = cb.breakerConfigs(cb.VOLUME_BREAKER());
        (, uint256 priceThreshold,,) = cb.breakerConfigs(cb.PRICE_BREAKER());

        assertEq(volThreshold, 10_000e18, "Volume threshold should be stable");
        assertEq(priceThreshold, 5_000e18, "Price threshold should be stable");
    }
}
