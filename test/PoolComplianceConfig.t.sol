// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/core/PoolComplianceConfig.sol";

/// @notice Harness to test the PoolComplianceConfig library
contract PoolComplianceConfigHarness {
    using PoolComplianceConfig for PoolComplianceConfig.Config;

    mapping(bytes32 => PoolComplianceConfig.Config) public configs;

    function storeConfig(bytes32 poolId, PoolComplianceConfig.PoolPreset preset) external {
        configs[poolId] = PoolComplianceConfig.fromPreset(preset);
    }

    function storeConfigWithBlockedJurisdictions(
        bytes32 poolId,
        PoolComplianceConfig.PoolPreset preset,
        bytes2[] calldata blocked
    ) external {
        configs[poolId] = PoolComplianceConfig.fromPreset(preset);
        for (uint256 i = 0; i < blocked.length; i++) {
            configs[poolId].blockedJurisdictions.push(blocked[i]);
        }
    }

    function getConfig(bytes32 poolId) external view returns (
        uint8 minTier,
        bool kyc,
        bool accreditation,
        uint256 maxTrade,
        string memory poolType,
        bool initialized
    ) {
        PoolComplianceConfig.Config storage c = configs[poolId];
        return (c.minTierRequired, c.kycRequired, c.accreditationRequired, c.maxTradeSize, c.poolType, c.initialized);
    }

    function isBlocked(bytes32 poolId, bytes2 jurisdiction) external view returns (bool) {
        return configs[poolId].isJurisdictionBlocked(jurisdiction);
    }

    function getBlockedCount(bytes32 poolId) external view returns (uint256) {
        return configs[poolId].blockedJurisdictions.length;
    }

    // Direct preset functions
    function createOpen() external pure returns (PoolComplianceConfig.Config memory) {
        return PoolComplianceConfig.createOpenConfig();
    }

    function createRetail() external pure returns (PoolComplianceConfig.Config memory) {
        return PoolComplianceConfig.createRetailConfig();
    }

    function createAccredited() external pure returns (PoolComplianceConfig.Config memory) {
        return PoolComplianceConfig.createAccreditedConfig();
    }

    function createInstitutional() external pure returns (PoolComplianceConfig.Config memory) {
        return PoolComplianceConfig.createInstitutionalConfig();
    }

    function fromPreset(PoolComplianceConfig.PoolPreset preset) external pure returns (PoolComplianceConfig.Config memory) {
        return PoolComplianceConfig.fromPreset(preset);
    }
}

contract PoolComplianceConfigTest is Test {
    PoolComplianceConfigHarness public harness;

    function setUp() public {
        harness = new PoolComplianceConfigHarness();
    }

    // ============ Open Config ============

    function test_openConfig() public view {
        PoolComplianceConfig.Config memory c = harness.createOpen();
        assertEq(c.minTierRequired, 0);
        assertFalse(c.kycRequired);
        assertFalse(c.accreditationRequired);
        assertEq(c.maxTradeSize, 0);
        assertEq(c.poolType, "open");
        assertTrue(c.initialized);
    }

    // ============ Retail Config ============

    function test_retailConfig() public view {
        PoolComplianceConfig.Config memory c = harness.createRetail();
        assertEq(c.minTierRequired, 2);
        assertTrue(c.kycRequired);
        assertFalse(c.accreditationRequired);
        assertEq(c.maxTradeSize, 100000 ether);
        assertEq(c.poolType, "retail");
        assertTrue(c.initialized);
    }

    // ============ Accredited Config ============

    function test_accreditedConfig() public view {
        PoolComplianceConfig.Config memory c = harness.createAccredited();
        assertEq(c.minTierRequired, 3);
        assertTrue(c.kycRequired);
        assertTrue(c.accreditationRequired);
        assertEq(c.maxTradeSize, 0);
        assertEq(c.poolType, "accredited");
        assertTrue(c.initialized);
    }

    // ============ Institutional Config ============

    function test_institutionalConfig() public view {
        PoolComplianceConfig.Config memory c = harness.createInstitutional();
        assertEq(c.minTierRequired, 4);
        assertTrue(c.kycRequired);
        assertTrue(c.accreditationRequired);
        assertEq(c.maxTradeSize, 0);
        assertEq(c.poolType, "institutional");
        assertTrue(c.initialized);
    }

    // ============ fromPreset ============

    function test_fromPreset_open() public view {
        PoolComplianceConfig.Config memory c = harness.fromPreset(PoolComplianceConfig.PoolPreset.OPEN);
        assertEq(c.minTierRequired, 0);
        assertFalse(c.kycRequired);
    }

    function test_fromPreset_retail() public view {
        PoolComplianceConfig.Config memory c = harness.fromPreset(PoolComplianceConfig.PoolPreset.RETAIL);
        assertEq(c.minTierRequired, 2);
        assertTrue(c.kycRequired);
    }

    function test_fromPreset_accredited() public view {
        PoolComplianceConfig.Config memory c = harness.fromPreset(PoolComplianceConfig.PoolPreset.ACCREDITED);
        assertEq(c.minTierRequired, 3);
        assertTrue(c.accreditationRequired);
    }

    function test_fromPreset_institutional() public view {
        PoolComplianceConfig.Config memory c = harness.fromPreset(PoolComplianceConfig.PoolPreset.INSTITUTIONAL);
        assertEq(c.minTierRequired, 4);
    }

    // ============ Store and Retrieve ============

    function test_storeAndRetrieve() public {
        bytes32 poolId = keccak256("pool1");
        harness.storeConfig(poolId, PoolComplianceConfig.PoolPreset.RETAIL);

        (uint8 minTier, bool kyc, bool accreditation, uint256 maxTrade, string memory poolType, bool initialized) = harness.getConfig(poolId);
        assertEq(minTier, 2);
        assertTrue(kyc);
        assertFalse(accreditation);
        assertEq(maxTrade, 100000 ether);
        assertEq(poolType, "retail");
        assertTrue(initialized);
    }

    // ============ Jurisdiction Blocking ============

    function test_jurisdictionBlocking() public {
        bytes32 poolId = keccak256("pool1");
        bytes2[] memory blocked = new bytes2[](2);
        blocked[0] = bytes2("US");
        blocked[1] = bytes2("CN");

        harness.storeConfigWithBlockedJurisdictions(poolId, PoolComplianceConfig.PoolPreset.OPEN, blocked);

        assertTrue(harness.isBlocked(poolId, bytes2("US")));
        assertTrue(harness.isBlocked(poolId, bytes2("CN")));
        assertFalse(harness.isBlocked(poolId, bytes2("GB")));
        assertFalse(harness.isBlocked(poolId, bytes2("JP")));
    }

    function test_noBlockedJurisdictions() public {
        bytes32 poolId = keccak256("pool1");
        harness.storeConfig(poolId, PoolComplianceConfig.PoolPreset.OPEN);

        assertFalse(harness.isBlocked(poolId, bytes2("US")));
        assertEq(harness.getBlockedCount(poolId), 0);
    }

    function test_blockedJurisdictionCount() public {
        bytes32 poolId = keccak256("pool1");
        bytes2[] memory blocked = new bytes2[](3);
        blocked[0] = bytes2("US");
        blocked[1] = bytes2("CN");
        blocked[2] = bytes2("RU");

        harness.storeConfigWithBlockedJurisdictions(poolId, PoolComplianceConfig.PoolPreset.RETAIL, blocked);
        assertEq(harness.getBlockedCount(poolId), 3);
    }

    // ============ Multiple Pools ============

    function test_multiplePools() public {
        bytes32 pool1 = keccak256("pool1");
        bytes32 pool2 = keccak256("pool2");

        harness.storeConfig(pool1, PoolComplianceConfig.PoolPreset.OPEN);
        harness.storeConfig(pool2, PoolComplianceConfig.PoolPreset.INSTITUTIONAL);

        (uint8 tier1, , , , ,) = harness.getConfig(pool1);
        (uint8 tier2, , , , ,) = harness.getConfig(pool2);

        assertEq(tier1, 0);
        assertEq(tier2, 4);
    }

    // ============ Uninitialized Pool ============

    function test_uninitializedPool() public view {
        bytes32 poolId = keccak256("nonexistent");
        (, , , , , bool initialized) = harness.getConfig(poolId);
        assertFalse(initialized);
    }

    // ============ Tier Ordering ============

    function test_tierOrdering() public view {
        PoolComplianceConfig.Config memory open = harness.createOpen();
        PoolComplianceConfig.Config memory retail = harness.createRetail();
        PoolComplianceConfig.Config memory accredited = harness.createAccredited();
        PoolComplianceConfig.Config memory institutional = harness.createInstitutional();

        assertLt(open.minTierRequired, retail.minTierRequired);
        assertLt(retail.minTierRequired, accredited.minTierRequired);
        assertLt(accredited.minTierRequired, institutional.minTierRequired);
    }
}
