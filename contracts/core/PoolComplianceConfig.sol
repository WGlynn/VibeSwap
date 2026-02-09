// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PoolComplianceConfig
 * @notice Immutable per-pool ACCESS CONTROL configurations
 * @dev Pools only differ in WHO can trade, not HOW trading works.
 *      Safety parameters (collateral, slashing, timing) are protocol-level constants.
 *
 * Design Philosophy:
 * - ACCESS CONTROL varies by pool (for regulatory compliance)
 * - SAFETY PARAMETERS are protocol constants (uniform fairness)
 * - IMMUTABLE: Pool access rules cannot be changed after creation
 * - NEUTRAL: No admin can modify rules - they're baked in
 *
 * What varies by pool (access control):
 * - Minimum user tier required
 * - KYC verification requirements
 * - Accredited investor requirements
 * - Blocked jurisdictions
 * - Maximum trade sizes (regulatory limits)
 *
 * What is FIXED protocol-wide (safety/fairness):
 * - Collateral requirements (uniform)
 * - Slash rates (uniform)
 * - Flash loan protection (always on)
 * - Batch timing (uniform)
 */
library PoolComplianceConfig {

    // ============ Structs ============

    /// @notice Immutable ACCESS CONTROL configuration for a pool
    /// @dev Only controls WHO can trade. HOW trading works is protocol-level.
    struct Config {
        // ---- Access Control ----
        uint8 minTierRequired;        // Minimum user tier (0=open, 2=retail, 3=accredited, 4=institutional)
        bool kycRequired;             // Whether KYC verification is required
        bool accreditationRequired;   // Whether accredited investor status is required

        // ---- Regulatory Limits ----
        uint256 maxTradeSize;         // Maximum single trade size (0 = protocol default)

        // ---- Jurisdiction ----
        bytes2[] blockedJurisdictions;  // ISO country codes that cannot trade

        // ---- Metadata ----
        string poolType;              // Human-readable pool type (e.g., "retail", "institutional")
        bool initialized;             // Whether config has been set
    }

    /// @notice Preset configurations for common pool types
    enum PoolPreset {
        OPEN,           // No restrictions, anyone can trade
        RETAIL,         // Basic KYC required
        ACCREDITED,     // Accredited investor verification required
        INSTITUTIONAL   // QIB verification required
    }

    // ============ Events ============

    event PoolAccessConfigCreated(
        bytes32 indexed poolId,
        PoolPreset preset,
        string poolType,
        uint8 minTierRequired,
        bool kycRequired,
        bool accreditationRequired
    );

    // ============ Functions ============

    /**
     * @notice Create an OPEN pool config (no access restrictions)
     * @dev Anyone can trade, no KYC required
     */
    function createOpenConfig() internal pure returns (Config memory) {
        bytes2[] memory blocked = new bytes2[](0);
        return Config({
            minTierRequired: 0,           // Anyone can trade
            kycRequired: false,
            accreditationRequired: false,
            maxTradeSize: 0,              // Use protocol default
            blockedJurisdictions: blocked,
            poolType: "open",
            initialized: true
        });
    }

    /**
     * @notice Create a RETAIL pool config (basic KYC)
     * @dev Requires KYC verification, tier 2+
     */
    function createRetailConfig() internal pure returns (Config memory) {
        bytes2[] memory blocked = new bytes2[](0);
        return Config({
            minTierRequired: 2,           // Retail tier minimum
            kycRequired: true,
            accreditationRequired: false,
            maxTradeSize: 100000 ether,   // $100k max trade (regulatory limit)
            blockedJurisdictions: blocked,
            poolType: "retail",
            initialized: true
        });
    }

    /**
     * @notice Create an ACCREDITED pool config
     * @dev Requires accredited investor status, tier 3+
     */
    function createAccreditedConfig() internal pure returns (Config memory) {
        bytes2[] memory blocked = new bytes2[](0);
        return Config({
            minTierRequired: 3,           // Accredited tier minimum
            kycRequired: true,
            accreditationRequired: true,
            maxTradeSize: 0,              // No regulatory limit
            blockedJurisdictions: blocked,
            poolType: "accredited",
            initialized: true
        });
    }

    /**
     * @notice Create an INSTITUTIONAL pool config
     * @dev Requires QIB status, tier 4+
     */
    function createInstitutionalConfig() internal pure returns (Config memory) {
        bytes2[] memory blocked = new bytes2[](0);
        return Config({
            minTierRequired: 4,           // Institutional tier minimum
            kycRequired: true,
            accreditationRequired: true,
            maxTradeSize: 0,              // No regulatory limit
            blockedJurisdictions: blocked,
            poolType: "institutional",
            initialized: true
        });
    }

    /**
     * @notice Create a config from a preset
     * @param preset The preset type to use
     * @return config The configuration
     */
    function fromPreset(PoolPreset preset) internal pure returns (Config memory config) {
        if (preset == PoolPreset.OPEN) {
            return createOpenConfig();
        } else if (preset == PoolPreset.RETAIL) {
            return createRetailConfig();
        } else if (preset == PoolPreset.ACCREDITED) {
            return createAccreditedConfig();
        } else {
            return createInstitutionalConfig();
        }
    }

    /**
     * @notice Check if a jurisdiction is blocked for this pool
     * @param config Pool configuration
     * @param jurisdiction ISO country code to check
     * @return blocked Whether the jurisdiction is blocked
     */
    function isJurisdictionBlocked(
        Config storage config,
        bytes2 jurisdiction
    ) internal view returns (bool) {
        for (uint256 i = 0; i < config.blockedJurisdictions.length; i++) {
            if (config.blockedJurisdictions[i] == jurisdiction) {
                return true;
            }
        }
        return false;
    }
}
