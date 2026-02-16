// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "../../contracts/oracles/StablecoinFlowRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Handler ============

contract SFRHandler is Test {
    StablecoinFlowRegistry public registry;
    address public updater;

    // Ghost variables
    uint256 public ghost_updateCount;

    constructor(StablecoinFlowRegistry _registry, address _updater) {
        registry = _registry;
        updater = _updater;
    }

    function updateRatio(uint256 ratio) public {
        // Bound to valid range: 0.01 to 100.0
        ratio = bound(ratio, 1e16, 1e20);

        vm.prank(updater);
        try registry.updateFlowRatio(ratio) {
            ghost_updateCount++;
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1, 7 days);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract StablecoinFlowRegistryInvariantTest is StdInvariant, Test {
    StablecoinFlowRegistry public registry;
    SFRHandler public handler;

    address public owner;
    address public updater;

    function setUp() public {
        owner = address(this);
        updater = makeAddr("updater");

        StablecoinFlowRegistry impl = new StablecoinFlowRegistry();
        bytes memory initData = abi.encodeWithSelector(
            StablecoinFlowRegistry.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = StablecoinFlowRegistry(address(proxy));

        registry.setAuthorizedUpdater(updater, true);

        handler = new SFRHandler(registry, updater);
        targetContract(address(handler));
    }

    // ============ Invariant: ratio always in valid bounds ============

    function invariant_ratioAlwaysInBounds() public view {
        uint256 ratio = registry.currentFlowRatio();
        // Initial value is 1e18, valid range is [1e16, 1e20]
        assertGe(ratio, 1e16, "RATIO: below minimum bound");
        assertLe(ratio, 1e20, "RATIO: above maximum bound");
    }

    // ============ Invariant: volatility multiplier bounded [1x, 3x] ============

    function invariant_volatilityMultiplierBounded() public view {
        uint256 mult = registry.getVolatilityMultiplier();
        assertGe(mult, 1e18, "VOL_MULT: below 1.0x");
        assertLe(mult, 3e18, "VOL_MULT: above 3.0x");
    }

    // ============ Invariant: trust reduction bounded [0, 0.5] ============

    function invariant_trustReductionBounded() public view {
        uint256 reduction = registry.getTrustReduction();
        assertLe(reduction, 5e17, "TRUST_REDUCTION: above 50%");
    }

    // ============ Invariant: manipulation probability bounded [0, 1.0] ============

    function invariant_manipProbBounded() public view {
        uint256 prob = registry.getManipulationProbability();
        assertLe(prob, 1e18, "MANIP_PROB: above 100%");
    }

    // ============ Invariant: history count bounded by HISTORY_SIZE ============

    function invariant_historyCountBounded() public view {
        uint8 count = registry.historyCount();
        assertLe(count, 24, "HISTORY: count exceeds HISTORY_SIZE");
    }
}
