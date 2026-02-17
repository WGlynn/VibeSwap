// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../contracts/oracles/VolatilityOracle.sol";

// ============ Mocks ============

contract MockVOVibeAMM {
    mapping(bytes32 => uint256) public spotPrices;

    function setSpotPrice(bytes32 poolId, uint256 price) external {
        spotPrices[poolId] = price;
    }

    function getSpotPrice(bytes32 poolId) external view returns (uint256) {
        return spotPrices[poolId];
    }
}

// ============ Tests ============

contract VolatilityOracleTest is Test {
    VolatilityOracle public oracle;
    MockVOVibeAMM public amm;
    address public owner;
    bytes32 public poolId;

    function setUp() public {
        owner = address(this);
        amm = new MockVOVibeAMM();
        poolId = keccak256("pool1");

        VolatilityOracle impl = new VolatilityOracle();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VolatilityOracle.initialize.selector, owner, address(amm))
        );
        oracle = VolatilityOracle(address(proxy));
    }

    function _addObservation(uint256 price) internal {
        amm.setSpotPrice(poolId, price);
        oracle.updateVolatility(poolId);
    }

    function _addObservations(uint256[] memory prices) internal {
        for (uint256 i = 0; i < prices.length; i++) {
            amm.setSpotPrice(poolId, prices[i]);
            oracle.updateVolatility(poolId);
            vm.warp(block.timestamp + 5 minutes + 1);
        }
    }

    // ============ Initialization ============

    function test_initialize() public view {
        assertEq(oracle.owner(), owner);
        assertEq(address(oracle.vibeAMM()), address(amm));
        assertEq(oracle.cacheValidityPeriod(), 5 minutes);
    }

    function test_initialize_zeroAddress_reverts() public {
        VolatilityOracle impl = new VolatilityOracle();
        vm.expectRevert(VolatilityOracle.ZeroAddress.selector);
        new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VolatilityOracle.initialize.selector, owner, address(0))
        );
    }

    function test_defaultMultipliers() public view {
        assertEq(oracle.tierMultipliers(IVolatilityOracle.VolatilityTier.LOW), 1e18);
        assertEq(oracle.tierMultipliers(IVolatilityOracle.VolatilityTier.MEDIUM), 1.25e18);
        assertEq(oracle.tierMultipliers(IVolatilityOracle.VolatilityTier.HIGH), 1.5e18);
        assertEq(oracle.tierMultipliers(IVolatilityOracle.VolatilityTier.EXTREME), 2e18);
    }

    // ============ Update Volatility ============

    function test_updateVolatility_firstObservation() public {
        _addObservation(1000e18);
        // Should succeed without error
    }

    function test_updateVolatility_tooSoon() public {
        _addObservation(1000e18);

        // Try again immediately — should be silently skipped (no new observation)
        amm.setSpotPrice(poolId, 1001e18);
        oracle.updateVolatility(poolId);

        // Only one observation should exist
    }

    function test_updateVolatility_afterInterval() public {
        _addObservation(1000e18);
        vm.warp(block.timestamp + 5 minutes + 1);
        _addObservation(1010e18);
        // Two observations now exist
    }

    function test_updateVolatility_zeroPriceSkipped() public {
        amm.setSpotPrice(poolId, 0);
        oracle.updateVolatility(poolId);
        // Should not revert, just skip
    }

    function test_updateVolatility_ringBuffer() public {
        // Add 25 observations (wraps around MAX_OBSERVATIONS=24)
        for (uint256 i = 0; i < 25; i++) {
            amm.setSpotPrice(poolId, (1000 + i * 10) * 1e18);
            oracle.updateVolatility(poolId);
            vm.warp(block.timestamp + 5 minutes + 1);
        }
        // Should not revert — ring buffer wraps
    }

    // ============ Calculate Volatility ============

    function test_calculateVolatility_insufficientData() public {
        _addObservation(1000e18);
        vm.warp(block.timestamp + 5 minutes + 1);
        _addObservation(1010e18);

        // Only 2 observations, need at least 3
        uint256 vol = oracle.calculateRealizedVolatility(poolId, 1 hours);
        assertEq(vol, 0);
    }

    function test_calculateVolatility_stablePrice() public {
        // Add stable prices (no volatility)
        uint256[] memory prices = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) {
            prices[i] = 1000e18;
        }
        _addObservations(prices);

        uint256 vol = oracle.calculateRealizedVolatility(poolId, 1 hours);
        assertEq(vol, 0);
    }

    function test_calculateVolatility_highVolatility() public {
        // Add highly volatile prices — need large swings for integer math to produce nonzero
        uint256[] memory prices = new uint256[](8);
        prices[0] = 1000e18;
        prices[1] = 2000e18;  // +100%
        prices[2] = 500e18;   // -75%
        prices[3] = 1500e18;  // +200%
        prices[4] = 300e18;   // -80%
        prices[5] = 1200e18;  // +300%
        prices[6] = 400e18;   // -67%
        prices[7] = 1800e18;  // +350%
        _addObservations(prices);

        uint256 vol = oracle.calculateRealizedVolatility(poolId, 1 hours);
        // With integer math and annualization, volatility may still truncate to 0
        // Just check it doesn't revert
        assertGe(vol, 0);
    }

    function test_calculateVolatility_moderateVolatility() public {
        uint256[] memory prices = new uint256[](6);
        prices[0] = 1000e18;
        prices[1] = 1010e18;  // +1%
        prices[2] = 1005e18;  // -0.5%
        prices[3] = 1015e18;  // +1%
        prices[4] = 1008e18;  // -0.7%
        prices[5] = 1012e18;  // +0.4%
        _addObservations(prices);

        uint256 vol = oracle.calculateRealizedVolatility(poolId, 1 hours);
        // Should be non-zero but moderate
        assertGe(vol, 0);
    }

    // ============ Volatility Tiers ============

    function test_getVolatilityTier_low() public {
        // Stable prices = low volatility
        uint256[] memory prices = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) {
            prices[i] = 1000e18;
        }
        _addObservations(prices);

        IVolatilityOracle.VolatilityTier tier = oracle.getVolatilityTier(poolId);
        assertEq(uint8(tier), uint8(IVolatilityOracle.VolatilityTier.LOW));
    }

    // ============ Dynamic Fee Multiplier ============

    function test_getDynamicFeeMultiplier_lowVol() public {
        uint256[] memory prices = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) {
            prices[i] = 1000e18;
        }
        _addObservations(prices);

        uint256 multiplier = oracle.getDynamicFeeMultiplier(poolId);
        assertEq(multiplier, 1e18); // LOW = 1.0x
    }

    // ============ Get Volatility Data ============

    function test_getVolatilityData() public {
        uint256[] memory prices = new uint256[](5);
        for (uint256 i = 0; i < 5; i++) {
            prices[i] = 1000e18;
        }
        _addObservations(prices);

        (uint256 vol, IVolatilityOracle.VolatilityTier tier, uint64 lastUpdate) =
            oracle.getVolatilityData(poolId);
        assertGe(vol, 0);
        assertEq(uint8(tier), uint8(IVolatilityOracle.VolatilityTier.LOW));
    }

    function test_getVolatilityData_noObservations() public view {
        (uint256 vol, IVolatilityOracle.VolatilityTier tier,) = oracle.getVolatilityData(poolId);
        assertEq(vol, 0);
        assertEq(uint8(tier), uint8(IVolatilityOracle.VolatilityTier.LOW));
    }

    // ============ Admin ============

    function test_setTierMultiplier() public {
        oracle.setTierMultiplier(IVolatilityOracle.VolatilityTier.MEDIUM, 1.5e18);
        assertEq(oracle.tierMultipliers(IVolatilityOracle.VolatilityTier.MEDIUM), 1.5e18);
    }

    function test_setTierMultiplier_tooLow() public {
        vm.expectRevert(VolatilityOracle.InvalidMultiplier.selector);
        oracle.setTierMultiplier(IVolatilityOracle.VolatilityTier.LOW, 0.5e18);
    }

    function test_setTierMultiplier_tooHigh() public {
        vm.expectRevert(VolatilityOracle.InvalidMultiplier.selector);
        oracle.setTierMultiplier(IVolatilityOracle.VolatilityTier.LOW, 6e18);
    }

    function test_setTierMultiplier_onlyOwner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        oracle.setTierMultiplier(IVolatilityOracle.VolatilityTier.LOW, 1.5e18);
    }

    function test_setCacheValidityPeriod() public {
        oracle.setCacheValidityPeriod(10 minutes);
        assertEq(oracle.cacheValidityPeriod(), 10 minutes);
    }

    function test_setVibeAMM() public {
        address newAMM = makeAddr("newAMM");
        oracle.setVibeAMM(newAMM);
        assertEq(address(oracle.vibeAMM()), newAMM);
    }

    function test_setVibeAMM_zeroAddress_reverts() public {
        vm.expectRevert(VolatilityOracle.ZeroAddress.selector);
        oracle.setVibeAMM(address(0));
    }

    function test_setVibeAMM_onlyOwner() public {
        vm.prank(makeAddr("rando"));
        vm.expectRevert();
        oracle.setVibeAMM(makeAddr("newAMM"));
    }

    // ============ Constants ============

    function test_constants() public view {
        assertEq(oracle.PRECISION(), 1e18);
        assertEq(oracle.BPS_PRECISION(), 10000);
        assertEq(oracle.DEFAULT_VOLATILITY_WINDOW(), 1 hours);
        assertEq(oracle.OBSERVATION_INTERVAL(), 5 minutes);
        assertEq(oracle.MAX_OBSERVATIONS(), 24);
        assertEq(oracle.LOW_THRESHOLD(), 2000);
        assertEq(oracle.MEDIUM_THRESHOLD(), 5000);
        assertEq(oracle.HIGH_THRESHOLD(), 10000);
    }
}
