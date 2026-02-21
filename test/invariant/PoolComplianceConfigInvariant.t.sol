// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/core/PoolComplianceConfig.sol";

// ============ Harness: exposes library internals for invariant testing ============

contract PCCInvariantHarness {
    using PoolComplianceConfig for PoolComplianceConfig.Config;

    mapping(bytes32 => PoolComplianceConfig.Config) public configs;
    bytes32[] public poolIds;

    /// @notice Create a config from a preset and store it
    function storeFromPreset(bytes32 poolId, uint8 presetRaw) external {
        PoolComplianceConfig.PoolPreset preset = PoolComplianceConfig.PoolPreset(presetRaw % 4);
        configs[poolId] = PoolComplianceConfig.fromPreset(preset);
        poolIds.push(poolId);
    }

    /// @notice Add a blocked jurisdiction to an existing pool
    function addBlockedJurisdiction(bytes32 poolId, bytes2 jurisdiction) external {
        configs[poolId].blockedJurisdictions.push(jurisdiction);
    }

    /// @notice Query functions
    function getConfig(bytes32 poolId) external view returns (PoolComplianceConfig.Config memory) {
        return configs[poolId];
    }

    function isBlocked(bytes32 poolId, bytes2 jurisdiction) external view returns (bool) {
        return configs[poolId].isJurisdictionBlocked(jurisdiction);
    }

    function getPoolCount() external view returns (uint256) {
        return poolIds.length;
    }
}

// ============ Handler: randomized state transitions ============

contract PCCInvariantHandler is Test {
    PCCInvariantHarness public harness;
    uint256 public poolCounter;

    // Track what we've done for ghost state
    mapping(bytes32 => uint8) public poolPresets; // poolId -> preset used
    mapping(bytes32 => bytes2[]) public poolBlockedJurisdictions;
    bytes32[] public createdPools;

    constructor(PCCInvariantHarness _harness) {
        harness = _harness;
    }

    function createPool(uint8 presetRaw) external {
        poolCounter++;
        bytes32 poolId = keccak256(abi.encodePacked(poolCounter, block.timestamp));
        uint8 preset = presetRaw % 4;

        harness.storeFromPreset(poolId, preset);
        poolPresets[poolId] = preset;
        createdPools.push(poolId);
    }

    function addBlockedJurisdiction(uint256 poolIndex, bytes2 jurisdiction) external {
        if (createdPools.length == 0) return;
        bytes32 poolId = createdPools[poolIndex % createdPools.length];

        harness.addBlockedJurisdiction(poolId, jurisdiction);
        poolBlockedJurisdictions[poolId].push(jurisdiction);
    }

    function getCreatedPools() external view returns (bytes32[] memory) {
        return createdPools;
    }

    function getGhostBlockedJurisdictions(bytes32 poolId) external view returns (bytes2[] memory) {
        return poolBlockedJurisdictions[poolId];
    }
}

// ============ Invariant Test ============

contract PoolComplianceConfigInvariantTest is Test {
    PCCInvariantHarness harness;
    PCCInvariantHandler handler;

    function setUp() public {
        harness = new PCCInvariantHarness();
        handler = new PCCInvariantHandler(harness);

        targetContract(address(handler));
    }

    /// @notice All stored configs must have initialized == true
    function invariant_allConfigsInitialized() public view {
        bytes32[] memory pools = handler.getCreatedPools();
        for (uint256 i = 0; i < pools.length; i++) {
            PoolComplianceConfig.Config memory cfg = harness.getConfig(pools[i]);
            assertTrue(cfg.initialized, "Config must be initialized");
        }
    }

    /// @notice KYC/accreditation monotonicity: accreditation implies KYC
    function invariant_accreditationImpliesKYC() public view {
        bytes32[] memory pools = handler.getCreatedPools();
        for (uint256 i = 0; i < pools.length; i++) {
            PoolComplianceConfig.Config memory cfg = harness.getConfig(pools[i]);
            if (cfg.accreditationRequired) {
                assertTrue(cfg.kycRequired, "Accreditation must imply KYC");
            }
        }
    }

    /// @notice Tier ordering: higher presets must have higher or equal tier requirements
    function invariant_tierOrdering() public view {
        bytes32[] memory pools = handler.getCreatedPools();
        for (uint256 i = 0; i < pools.length; i++) {
            for (uint256 j = i + 1; j < pools.length; j++) {
                uint8 presetI = handler.poolPresets(pools[i]);
                uint8 presetJ = handler.poolPresets(pools[j]);

                if (presetI < presetJ) {
                    PoolComplianceConfig.Config memory cfgI = harness.getConfig(pools[i]);
                    PoolComplianceConfig.Config memory cfgJ = harness.getConfig(pools[j]);
                    assertTrue(
                        cfgI.minTierRequired <= cfgJ.minTierRequired,
                        "Higher preset must have >= tier"
                    );
                }
            }
        }
    }

    /// @notice All blocked jurisdictions must be detected
    function invariant_blockedJurisdictionsDetected() public view {
        bytes32[] memory pools = handler.getCreatedPools();
        for (uint256 i = 0; i < pools.length; i++) {
            bytes2[] memory blocked = handler.getGhostBlockedJurisdictions(pools[i]);
            for (uint256 j = 0; j < blocked.length; j++) {
                assertTrue(
                    harness.isBlocked(pools[i], blocked[j]),
                    "Blocked jurisdiction must be detected"
                );
            }
        }
    }

    /// @notice Only RETAIL preset has non-zero maxTradeSize
    function invariant_maxTradeSizeOnlyRetail() public view {
        bytes32[] memory pools = handler.getCreatedPools();
        for (uint256 i = 0; i < pools.length; i++) {
            PoolComplianceConfig.Config memory cfg = harness.getConfig(pools[i]);
            uint8 preset = handler.poolPresets(pools[i]);

            if (preset != 1) { // Not RETAIL
                assertEq(cfg.maxTradeSize, 0, "Non-RETAIL preset must have maxTradeSize == 0");
            } else {
                assertEq(cfg.maxTradeSize, 100000 ether, "RETAIL must have maxTradeSize == 100000 ether");
            }
        }
    }

    /// @notice Pool count in harness matches handler's created pool count
    function invariant_poolCountConsistency() public view {
        assertEq(harness.getPoolCount(), handler.getCreatedPools().length);
    }
}
