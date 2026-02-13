// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/oracles/StablecoinFlowRegistry.sol";
import "../../contracts/oracles/interfaces/IStablecoinFlowRegistry.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract StablecoinFlowRegistryTest is Test {
    StablecoinFlowRegistry public registry;

    address public owner;
    uint256 public updaterPrivateKey;
    address public updater;
    address public unauthorized;

    bytes32 public DOMAIN_SEPARATOR;

    uint256 constant PRECISION = 1e18;

    bytes32 constant FLOW_UPDATE_TYPEHASH = keccak256(
        "FlowUpdate(uint256 newRatio,uint256 nonce,uint256 deadline)"
    );

    event FlowRatioUpdated(uint256 newRatio, uint256 avgRatio7d, uint64 timestamp);
    event RegimeChanged(bool isUsdtDominant, bool isUsdcDominant);
    event UpdaterAuthorized(address indexed updater, bool authorized);

    function setUp() public {
        owner = address(this);
        updaterPrivateKey = 0xB0B;
        updater = vm.addr(updaterPrivateKey);
        unauthorized = makeAddr("unauthorized");

        // Deploy registry
        StablecoinFlowRegistry impl = new StablecoinFlowRegistry();
        bytes memory initData = abi.encodeWithSelector(
            StablecoinFlowRegistry.initialize.selector,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        registry = StablecoinFlowRegistry(address(proxy));

        // Authorize updater
        registry.setAuthorizedUpdater(updater, true);

        DOMAIN_SEPARATOR = registry.DOMAIN_SEPARATOR();
    }

    // ============ Helper Functions ============

    function _createFlowSignature(
        uint256 newRatio,
        uint256 nonce,
        uint256 deadline
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(
            FLOW_UPDATE_TYPEHASH,
            newRatio,
            nonce,
            deadline
        ));

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(updaterPrivateKey, digest);

        return abi.encodePacked(r, s, v, nonce, deadline);
    }

    // ============ Initialization Tests ============

    function test_initialize() public view {
        assertEq(registry.owner(), owner);
        assertEq(registry.currentFlowRatio(), PRECISION); // 1.0
        assertEq(registry.avgFlowRatio7d(), PRECISION);
        assertTrue(registry.DOMAIN_SEPARATOR() != bytes32(0));
    }

    function test_initialize_zeroOwner() public {
        StablecoinFlowRegistry impl = new StablecoinFlowRegistry();
        bytes memory initData = abi.encodeWithSelector(
            StablecoinFlowRegistry.initialize.selector,
            address(0)
        );

        vm.expectRevert(StablecoinFlowRegistry.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), initData);
    }

    // ============ Updater Authorization Tests ============

    function test_setAuthorizedUpdater() public {
        address newUpdater = makeAddr("newUpdater");

        vm.expectEmit(true, false, false, true);
        emit UpdaterAuthorized(newUpdater, true);

        registry.setAuthorizedUpdater(newUpdater, true);
        assertTrue(registry.authorizedUpdaters(newUpdater));

        registry.setAuthorizedUpdater(newUpdater, false);
        assertFalse(registry.authorizedUpdaters(newUpdater));
    }

    function test_setAuthorizedUpdater_zeroAddress() public {
        vm.expectRevert(StablecoinFlowRegistry.ZeroAddress.selector);
        registry.setAuthorizedUpdater(address(0), true);
    }

    function test_setAuthorizedUpdater_onlyOwner() public {
        vm.prank(unauthorized);
        vm.expectRevert();
        registry.setAuthorizedUpdater(unauthorized, true);
    }

    // ============ Flow Ratio Update Tests ============

    function test_updateFlowRatio() public {
        vm.prank(updater);

        vm.expectEmit(false, false, false, true);
        emit FlowRatioUpdated(15e17, 15e17, uint64(block.timestamp));

        registry.updateFlowRatio(15e17); // 1.5

        assertEq(registry.currentFlowRatio(), 15e17);
    }

    function test_updateFlowRatio_unauthorized() public {
        vm.prank(unauthorized);
        vm.expectRevert(StablecoinFlowRegistry.Unauthorized.selector);
        registry.updateFlowRatio(15e17);
    }

    function test_updateFlowRatioSigned() public {
        uint256 nonce = registry.getNonce(updater);
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig = _createFlowSignature(25e17, nonce, deadline);

        registry.updateFlowRatioSigned(25e17, sig);

        assertEq(registry.currentFlowRatio(), 25e17);
        assertEq(registry.getNonce(updater), 1);
    }

    function test_updateFlowRatioSigned_expiredSignature() public {
        uint256 nonce = registry.getNonce(updater);
        uint256 deadline = block.timestamp - 1;

        bytes memory sig = _createFlowSignature(25e17, nonce, deadline);

        vm.expectRevert(StablecoinFlowRegistry.ExpiredSignature.selector);
        registry.updateFlowRatioSigned(25e17, sig);
    }

    function test_updateFlowRatioSigned_invalidNonce() public {
        uint256 wrongNonce = 999;
        uint256 deadline = block.timestamp + 1 hours;

        bytes memory sig = _createFlowSignature(25e17, wrongNonce, deadline);

        vm.expectRevert(StablecoinFlowRegistry.InvalidNonce.selector);
        registry.updateFlowRatioSigned(25e17, sig);
    }

    // ============ Regime Detection Tests ============

    function test_isUSDTDominant() public {
        // Default ratio 1.0: not dominant
        assertFalse(registry.isUSDTDominant());

        // Set to 2.5 (> 2.0 threshold)
        vm.prank(updater);
        registry.updateFlowRatio(25e17);
        assertTrue(registry.isUSDTDominant());

        // Set to 1.5 (< 2.0 threshold)
        vm.prank(updater);
        registry.updateFlowRatio(15e17);
        assertFalse(registry.isUSDTDominant());
    }

    function test_isUSDCDominant() public {
        // Default ratio 1.0: not dominant
        assertFalse(registry.isUSDCDominant());

        // Set to 0.4 (< 0.5 threshold)
        vm.prank(updater);
        registry.updateFlowRatio(4e17);
        assertTrue(registry.isUSDCDominant());

        // Set to 0.6 (> 0.5 threshold)
        vm.prank(updater);
        registry.updateFlowRatio(6e17);
        assertFalse(registry.isUSDCDominant());
    }

    function test_regimeChangeEvent() public {
        vm.prank(updater);

        // Change to USDT dominant
        vm.expectEmit(false, false, false, true);
        emit RegimeChanged(true, false);
        registry.updateFlowRatio(25e17);

        // Change back to neutral
        vm.expectEmit(false, false, false, true);
        emit RegimeChanged(false, false);
        vm.prank(updater);
        registry.updateFlowRatio(PRECISION);

        // Change to USDC dominant
        vm.expectEmit(false, false, false, true);
        emit RegimeChanged(false, true);
        vm.prank(updater);
        registry.updateFlowRatio(4e17);
    }

    // ============ Manipulation Probability Tests ============

    function test_getManipulationProbability_low() public {
        // Ratio 1.0: very low probability
        uint256 prob = registry.getManipulationProbability();
        assertLt(prob, PRECISION / 5); // < 20%
    }

    function test_getManipulationProbability_moderate() public {
        // Ratio 2.0: ~50% probability
        vm.prank(updater);
        registry.updateFlowRatio(2e18);

        uint256 prob = registry.getManipulationProbability();
        assertApproxEqRel(prob, PRECISION / 2, 0.1e18); // ~50% ± 10%
    }

    function test_getManipulationProbability_high() public {
        // Ratio 3.5+: very high probability
        vm.prank(updater);
        registry.updateFlowRatio(4e18);

        uint256 prob = registry.getManipulationProbability();
        assertEq(prob, PRECISION); // 100%
    }

    // ============ Volatility Multiplier Tests ============

    function test_getVolatilityMultiplier_base() public view {
        // Ratio 1.0: base multiplier
        uint256 mult = registry.getVolatilityMultiplier();
        assertEq(mult, PRECISION); // 1.0x
    }

    function test_getVolatilityMultiplier_elevated() public {
        // Ratio 2.5: elevated multiplier
        vm.prank(updater);
        registry.updateFlowRatio(25e17);

        uint256 mult = registry.getVolatilityMultiplier();
        assertGt(mult, PRECISION); // > 1.0x
        assertLt(mult, 3e18); // < 3.0x
    }

    function test_getVolatilityMultiplier_max() public {
        // Ratio 4.0+: max multiplier
        vm.prank(updater);
        registry.updateFlowRatio(5e18);

        uint256 mult = registry.getVolatilityMultiplier();
        assertEq(mult, 3e18); // 3.0x max
    }

    // ============ Trust Reduction Tests ============

    function test_getTrustReduction_none() public view {
        // Ratio 1.0: no reduction
        uint256 reduction = registry.getTrustReduction();
        assertEq(reduction, 0);
    }

    function test_getTrustReduction_moderate() public {
        // Ratio 2.0: moderate reduction
        vm.prank(updater);
        registry.updateFlowRatio(2e18);

        uint256 reduction = registry.getTrustReduction();
        assertGt(reduction, 0);
        assertLt(reduction, PRECISION / 2);
    }

    function test_getTrustReduction_max() public {
        // Ratio 3.0+: max reduction
        vm.prank(updater);
        registry.updateFlowRatio(4e18);

        uint256 reduction = registry.getTrustReduction();
        assertEq(reduction, PRECISION / 2); // 50% max
    }

    // ============ History Tests ============

    function test_flowRatioHistory() public {
        // Submit multiple updates
        uint256[] memory ratios = new uint256[](5);
        ratios[0] = 1e18;
        ratios[1] = 12e17;
        ratios[2] = 15e17;
        ratios[3] = 18e17;
        ratios[4] = 2e18;

        for (uint256 i = 0; i < 5; i++) {
            vm.prank(updater);
            registry.updateFlowRatio(ratios[i]);
            vm.warp(block.timestamp + 1 hours);
        }

        // Get history
        (uint256[] memory histRatios, uint64[] memory timestamps) = registry.getFlowRatioHistory(5);

        assertEq(histRatios.length, 5);
        assertEq(timestamps.length, 5);

        // Most recent first
        assertEq(histRatios[0], 2e18);
    }

    function test_getFlowRatioHistory_partial() public {
        // Submit 3 updates
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(updater);
            registry.updateFlowRatio((10 + i) * 1e17);
            vm.warp(block.timestamp + 1 hours);
        }

        // Request more than available
        (uint256[] memory ratios, ) = registry.getFlowRatioHistory(10);
        assertEq(ratios.length, 3); // Only returns what's available
    }

    function test_avgFlowRatio7d() public {
        // Submit updates that should average out
        vm.prank(updater);
        registry.updateFlowRatio(1e18);
        vm.warp(block.timestamp + 1 hours);

        vm.prank(updater);
        registry.updateFlowRatio(2e18);
        vm.warp(block.timestamp + 1 hours);

        vm.prank(updater);
        registry.updateFlowRatio(3e18);

        uint256 avg = registry.avgFlowRatio7d();
        // Average of 1, 2, 3 = 2
        assertEq(avg, 2e18);
    }

    // ============ Timestamp Tests ============

    function test_getLastUpdate() public {
        uint256 startTime = block.timestamp;

        vm.prank(updater);
        registry.updateFlowRatio(15e17);

        assertEq(registry.getLastUpdate(), startTime);

        vm.warp(block.timestamp + 1 hours);

        vm.prank(updater);
        registry.updateFlowRatio(16e17);

        assertEq(registry.getLastUpdate(), startTime + 1 hours);
    }

    // ============ View Functions Tests ============

    function test_getCurrentFlowRatio() public {
        assertEq(registry.getCurrentFlowRatio(), PRECISION);

        vm.prank(updater);
        registry.updateFlowRatio(25e17);

        assertEq(registry.getCurrentFlowRatio(), 25e17);
    }

    function test_getAverageFlowRatio() public view {
        // Initially same as current
        assertEq(registry.getAverageFlowRatio(), PRECISION);
    }

    // ============ Edge Cases ============

    function test_zeroRatio_reverts() public {
        vm.prank(updater);
        vm.expectRevert(StablecoinFlowRegistry.RatioOutOfBounds.selector);
        registry.updateFlowRatio(0);
    }

    function test_veryHighRatio() public {
        vm.prank(updater);
        registry.updateFlowRatio(100e18); // 100x

        assertTrue(registry.isUSDTDominant());
        assertEq(registry.getVolatilityMultiplier(), 3e18); // Capped at max
        assertEq(registry.getManipulationProbability(), PRECISION); // 100%
        assertEq(registry.getTrustReduction(), PRECISION / 2); // Max 50%
    }

    // ============ Fuzz Tests ============

    function testFuzz_updateFlowRatio(uint256 ratio) public {
        ratio = bound(ratio, PRECISION / 100, PRECISION * 100); // 0.01 to 100.0
        vm.prank(updater);
        registry.updateFlowRatio(ratio);

        assertEq(registry.currentFlowRatio(), ratio);
    }

    function testFuzz_volatilityMultiplierBounds(uint256 ratio) public {
        ratio = bound(ratio, PRECISION / 100, PRECISION * 100);
        vm.prank(updater);
        registry.updateFlowRatio(ratio);

        uint256 mult = registry.getVolatilityMultiplier();
        assertGe(mult, PRECISION); // >= 1.0x
        assertLe(mult, 3e18); // <= 3.0x
    }

    function testFuzz_manipulationProbabilityBounds(uint256 ratio) public {
        ratio = bound(ratio, PRECISION / 100, PRECISION * 100);
        vm.prank(updater);
        registry.updateFlowRatio(ratio);

        uint256 prob = registry.getManipulationProbability();
        assertLe(prob, PRECISION); // <= 100%
    }

    function testFuzz_trustReductionBounds(uint256 ratio) public {
        ratio = bound(ratio, PRECISION / 100, PRECISION * 100);
        vm.prank(updater);
        registry.updateFlowRatio(ratio);

        uint256 reduction = registry.getTrustReduction();
        assertLe(reduction, PRECISION / 2); // <= 50%
    }

    function test_ratioOutOfBounds_tooLow() public {
        vm.prank(updater);
        vm.expectRevert(StablecoinFlowRegistry.RatioOutOfBounds.selector);
        registry.updateFlowRatio(PRECISION / 100 - 1);
    }

    function test_ratioOutOfBounds_tooHigh() public {
        vm.prank(updater);
        vm.expectRevert(StablecoinFlowRegistry.RatioOutOfBounds.selector);
        registry.updateFlowRatio(PRECISION * 100 + 1);
    }
}
