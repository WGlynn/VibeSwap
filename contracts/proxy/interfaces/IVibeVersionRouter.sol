// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeVersionRouter
 * @notice Versioned proxy router — multiple implementation versions
 *         live simultaneously, users opt-in to upgrades.
 *
 *         Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *         Unlike UUPS/transparent proxies that force all users onto one
 *         implementation, the version router lets users choose:
 *           - Protocol registers new versions (v1, v2, v3...)
 *           - Users opt-in by calling selectVersion(versionId)
 *           - Calls to the router are delegated to the user's selected version
 *           - Default version for new users is the latest stable
 *
 *         This enables:
 *           - Gradual rollouts (beta → stable → deprecated)
 *           - No forced migrations
 *           - Parallel A/B testing of implementations
 *           - Safe rollback (user just selects previous version)
 *
 *         Version lifecycle:
 *           BETA → STABLE → DEPRECATED → SUNSET
 *
 *         Governance controls:
 *           - Only owner/timelock can register new versions
 *           - Version deprecation warns users but doesn't force migration
 *           - Sunset removes a version entirely (users auto-migrate to default)
 */
interface IVibeVersionRouter {
    // ============ Enums ============

    enum VersionStatus {
        BETA,        // Opt-in only, not default
        STABLE,      // Production-ready, can be default
        DEPRECATED,  // Still functional, warns users
        SUNSET       // Removed, users auto-migrate
    }

    // ============ Structs ============

    /// @notice Registered implementation version
    struct Version {
        address implementation;   // Contract address
        VersionStatus status;     // Lifecycle state
        uint40 registeredAt;      // Registration timestamp
        uint40 deprecatedAt;      // Deprecation timestamp (0 if not deprecated)
        uint16 versionNumber;     // Sequential version number
        string label;             // Human-readable label (e.g., "v2.1-beta")
    }

    // ============ Events ============

    event VersionRegistered(uint256 indexed versionId, address indexed implementation, uint16 versionNumber, string label);
    event VersionStatusUpdated(uint256 indexed versionId, VersionStatus status);
    event UserVersionSelected(address indexed user, uint256 indexed versionId);
    event DefaultVersionUpdated(uint256 indexed versionId);
    event VersionSunset(uint256 indexed versionId);
    event UserAutoMigrated(address indexed user, uint256 indexed fromVersion, uint256 indexed toVersion);

    // ============ Errors ============

    error ZeroAddress();
    error VersionNotFound();
    error VersionNotActive();
    error VersionAlreadySunset();
    error InvalidVersionTransition();
    error NoDefaultVersion();
    error DuplicateImplementation();

    // ============ User Functions ============

    function selectVersion(uint256 versionId) external;

    // ============ Admin Functions ============

    function registerVersion(address implementation, string calldata label) external;
    function setVersionStatus(uint256 versionId, VersionStatus status) external;
    function setDefaultVersion(uint256 versionId) external;
    function sunsetVersion(uint256 versionId) external;

    // ============ View Functions ============

    function getVersion(uint256 versionId) external view returns (Version memory);
    function totalVersions() external view returns (uint256);
    function defaultVersion() external view returns (uint256);
    function userVersion(address user) external view returns (uint256);
    function getImplementation(address user) external view returns (address);
    function latestStableVersion() external view returns (uint256);
}
