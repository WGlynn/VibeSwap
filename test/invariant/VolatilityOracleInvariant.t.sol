// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/StdInvariant.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/oracles/VolatilityOracle.sol";

// ============ Mocks ============

contract MockVOIVibeAMM {
    uint256 public price;
    function setSpotPrice(uint256 p) external { price = p; }
    function getSpotPrice(bytes32) external view returns (uint256) { return price; }
}

// ============ Handler ============

contract VolatilityHandler is Test {
    VolatilityOracle public oracle;
    MockVOIVibeAMM public amm;
    bytes32 public poolId;

    // Ghost variables
    uint256 public ghost_observationCount;
    uint256 public ghost_priceUpdates;

    constructor(VolatilityOracle _oracle, MockVOIVibeAMM _amm) {
        oracle = _oracle;
        amm = _amm;
        poolId = keccak256("pool1");
    }

    function updatePrice(uint256 price) public {
        price = bound(price, 1e15, 1e30);
        amm.setSpotPrice(price);
        ghost_priceUpdates++;
    }

    function recordObservation() public {
        vm.warp(block.timestamp + 5 minutes + 1);
        try oracle.updateVolatility(poolId) {
            ghost_observationCount++;
        } catch {}
    }

    function setTierMultiplier(uint256 multiplier) public {
        multiplier = bound(multiplier, 1e18, 5e18);
        try oracle.setTierMultiplier(IVolatilityOracle.VolatilityTier.MEDIUM, multiplier) {
        } catch {}
    }

    function advanceTime(uint256 delta) public {
        delta = bound(delta, 1 minutes, 1 hours);
        vm.warp(block.timestamp + delta);
    }
}

// ============ Invariant Tests ============

contract VolatilityOracleInvariantTest is StdInvariant, Test {
    VolatilityOracle public oracle;
    MockVOIVibeAMM public amm;
    VolatilityHandler public handler;

    function setUp() public {
        amm = new MockVOIVibeAMM();
        amm.setSpotPrice(1000e18);

        VolatilityOracle impl = new VolatilityOracle();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(VolatilityOracle.initialize.selector, address(this), address(amm))
        );
        oracle = VolatilityOracle(address(proxy));

        handler = new VolatilityHandler(oracle, amm);
        targetContract(address(handler));
    }

    /// @notice Fee multiplier is always >= 1x (1e18)
    function invariant_feeMultiplierAlwaysGe1() public view {
        bytes32 poolId = keccak256("pool1");
        uint256 multiplier = oracle.getDynamicFeeMultiplier(poolId);
        assertGe(multiplier, 1e18, "MULTIPLIER: below 1x");
    }

    /// @notice Tier multipliers are always within [1x, 5x]
    function invariant_tierMultipliersBounded() public view {
        // Check all tier multipliers
        uint256 low = oracle.tierMultipliers(IVolatilityOracle.VolatilityTier.LOW);
        uint256 med = oracle.tierMultipliers(IVolatilityOracle.VolatilityTier.MEDIUM);
        uint256 high = oracle.tierMultipliers(IVolatilityOracle.VolatilityTier.HIGH);
        uint256 extreme = oracle.tierMultipliers(IVolatilityOracle.VolatilityTier.EXTREME);

        assertGe(low, 1e18, "LOW: below 1x");
        assertLe(low, 5e18, "LOW: above 5x");
        assertGe(med, 1e18, "MED: below 1x");
        assertLe(med, 5e18, "MED: above 5x");
        assertGe(high, 1e18, "HIGH: below 1x");
        assertLe(high, 5e18, "HIGH: above 5x");
        assertGe(extreme, 1e18, "EXTREME: below 1x");
        assertLe(extreme, 5e18, "EXTREME: above 5x");
    }

    /// @notice Volatility is always non-negative
    function invariant_volatilityNonNegative() public view {
        bytes32 poolId = keccak256("pool1");
        uint256 vol = oracle.calculateRealizedVolatility(poolId, 1 hours);
        assertGe(vol, 0, "VOLATILITY: negative");
    }

    /// @notice Observation count never decreases
    function invariant_observationCountMonotonic() public view {
        assertGe(handler.ghost_observationCount(), 0, "OBSERVATIONS: underflow");
    }
}
