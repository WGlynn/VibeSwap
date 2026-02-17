// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/PoolComplianceConfig.sol";

/// @notice Harness to test the library in fuzz context
contract PCCFuzzHarness {
    using PoolComplianceConfig for PoolComplianceConfig.Config;

    mapping(bytes32 => PoolComplianceConfig.Config) public configs;

    function storeFromPreset(bytes32 poolId, uint8 presetIdx) external {
        if (presetIdx > 3) presetIdx = presetIdx % 4;
        configs[poolId] = PoolComplianceConfig.fromPreset(PoolComplianceConfig.PoolPreset(presetIdx));
    }

    function addBlockedJurisdiction(bytes32 poolId, bytes2 j) external {
        configs[poolId].blockedJurisdictions.push(j);
    }

    function isBlocked(bytes32 poolId, bytes2 j) external view returns (bool) {
        return configs[poolId].isJurisdictionBlocked(j);
    }

    function getMinTier(bytes32 poolId) external view returns (uint8) {
        return configs[poolId].minTierRequired;
    }

    function isInitialized(bytes32 poolId) external view returns (bool) {
        return configs[poolId].initialized;
    }
}

contract PoolComplianceConfigFuzzTest is Test {
    PCCFuzzHarness public harness;

    function setUp() public {
        harness = new PCCFuzzHarness();
    }

    /// @notice All presets are initialized
    function testFuzz_allPresetsInitialized(uint8 presetIdx) public {
        presetIdx = uint8(bound(presetIdx, 0, 3));
        bytes32 poolId = keccak256(abi.encodePacked("pool", presetIdx));

        harness.storeFromPreset(poolId, presetIdx);
        assertTrue(harness.isInitialized(poolId));
    }

    /// @notice MinTier increases with preset strictness
    function testFuzz_tierMonotonic(uint8 p1, uint8 p2) public {
        p1 = uint8(bound(p1, 0, 3));
        p2 = uint8(bound(p2, 0, 3));

        bytes32 id1 = keccak256(abi.encodePacked("pool", p1));
        bytes32 id2 = keccak256(abi.encodePacked("pool", p2));

        harness.storeFromPreset(id1, p1);
        harness.storeFromPreset(id2, p2);

        if (p1 < p2) {
            assertLe(harness.getMinTier(id1), harness.getMinTier(id2));
        }
    }

    /// @notice Blocked jurisdictions are always detected
    function testFuzz_blockedJurisdictionDetected(bytes2 jurisdiction) public {
        bytes32 poolId = keccak256("pool");
        harness.storeFromPreset(poolId, 0);
        harness.addBlockedJurisdiction(poolId, jurisdiction);

        assertTrue(harness.isBlocked(poolId, jurisdiction));
    }

    /// @notice Unblocked jurisdictions return false
    function testFuzz_unblockedJurisdictionFalse(bytes2 jurisdiction) public {
        bytes32 poolId = keccak256("pool");
        harness.storeFromPreset(poolId, 0);

        // Don't add any blocked jurisdictions
        assertFalse(harness.isBlocked(poolId, jurisdiction));
    }
}
