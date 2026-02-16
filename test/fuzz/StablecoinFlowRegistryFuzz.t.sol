// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/oracles/StablecoinFlowRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Fuzz Tests ============

contract StablecoinFlowRegistryFuzzTest is Test {
    StablecoinFlowRegistry public registry;

    address public owner;
    address public updater;

    uint256 constant PRECISION = 1e18;
    uint256 constant MIN_RATIO = PRECISION / 100;   // 0.01
    uint256 constant MAX_RATIO = PRECISION * 100;    // 100.0

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
    }

    // ============ Fuzz: regime detection consistent with ratio ============

    function testFuzz_regimeDetectionConsistent(uint256 ratio) public {
        ratio = bound(ratio, MIN_RATIO, MAX_RATIO);

        vm.prank(updater);
        registry.updateFlowRatio(ratio);

        bool usdtDom = registry.isUSDTDominant();
        bool usdcDom = registry.isUSDCDominant();

        if (ratio > 2e18) {
            assertTrue(usdtDom, "USDT dominant when ratio > 2.0");
        } else {
            assertFalse(usdtDom, "Not USDT dominant when ratio <= 2.0");
        }

        if (ratio < 5e17) {
            assertTrue(usdcDom, "USDC dominant when ratio < 0.5");
        } else {
            assertFalse(usdcDom, "Not USDC dominant when ratio >= 0.5");
        }

        // Cannot be both dominant simultaneously
        assertFalse(usdtDom && usdcDom, "Cannot be both USDT and USDC dominant");
    }

    // ============ Fuzz: volatility multiplier monotonic ============

    function testFuzz_volatilityMultiplierMonotonic(uint256 ratioLow, uint256 ratioHigh) public {
        ratioLow = bound(ratioLow, MIN_RATIO, MAX_RATIO - 1);
        ratioHigh = bound(ratioHigh, ratioLow + 1, MAX_RATIO);

        vm.prank(updater);
        registry.updateFlowRatio(ratioLow);
        uint256 multLow = registry.getVolatilityMultiplier();

        vm.prank(updater);
        registry.updateFlowRatio(ratioHigh);
        uint256 multHigh = registry.getVolatilityMultiplier();

        assertGe(multHigh, multLow, "Volatility multiplier must be monotonically non-decreasing");
    }

    // ============ Fuzz: trust reduction monotonic ============

    function testFuzz_trustReductionMonotonic(uint256 ratioLow, uint256 ratioHigh) public {
        ratioLow = bound(ratioLow, MIN_RATIO, MAX_RATIO - 1);
        ratioHigh = bound(ratioHigh, ratioLow + 1, MAX_RATIO);

        vm.prank(updater);
        registry.updateFlowRatio(ratioLow);
        uint256 reductionLow = registry.getTrustReduction();

        vm.prank(updater);
        registry.updateFlowRatio(ratioHigh);
        uint256 reductionHigh = registry.getTrustReduction();

        assertGe(reductionHigh, reductionLow, "Trust reduction must be monotonically non-decreasing");
    }

    // ============ Fuzz: average converges to constant input ============

    function testFuzz_averageConvergesToConstant(uint256 ratio) public {
        ratio = bound(ratio, MIN_RATIO, MAX_RATIO);

        // Submit the same ratio 24+ times to fill history buffer
        for (uint256 i = 0; i < 25; i++) {
            vm.prank(updater);
            registry.updateFlowRatio(ratio);
            vm.warp(block.timestamp + 1 hours);
        }

        // Average should equal the constant value
        assertEq(registry.avgFlowRatio7d(), ratio, "Average must equal constant input after buffer fill");
    }

    // ============ Fuzz: history ring buffer wraps correctly ============

    function testFuzz_historyBufferWraps(uint256 numUpdates) public {
        numUpdates = bound(numUpdates, 25, 100);

        uint256 lastRatio;
        for (uint256 i = 0; i < numUpdates; i++) {
            lastRatio = bound(uint256(keccak256(abi.encode(i))), MIN_RATIO, MAX_RATIO);
            vm.prank(updater);
            registry.updateFlowRatio(lastRatio);
            vm.warp(block.timestamp + 1 hours);
        }

        // History count should be capped at 24
        assertEq(registry.historyCount(), 24, "History count must be capped at HISTORY_SIZE");

        // Most recent ratio should be retrievable
        (uint256[] memory ratios, ) = registry.getFlowRatioHistory(1);
        assertEq(ratios[0], lastRatio, "Most recent ratio must be correct");
    }

    // ============ Fuzz: out-of-bounds ratios always revert ============

    function testFuzz_outOfBoundsRatioReverts(uint256 ratio) public {
        // Test values below min
        if (ratio < MIN_RATIO) {
            vm.prank(updater);
            vm.expectRevert(StablecoinFlowRegistry.RatioOutOfBounds.selector);
            registry.updateFlowRatio(ratio);
        }

        // Test values above max (separate check)
        uint256 highRatio = bound(ratio, MAX_RATIO + 1, type(uint256).max / 2);
        vm.prank(updater);
        vm.expectRevert(StablecoinFlowRegistry.RatioOutOfBounds.selector);
        registry.updateFlowRatio(highRatio);
    }
}
