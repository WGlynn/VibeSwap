// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IVibeVersionRouter.sol";

/**
 * @title VibeVersionRouter
 * @notice Versioned proxy router for opt-in upgrades.
 * @dev Part of VSOS (VibeSwap Operating System) Protocol Framework.
 *
 *      Multiple implementations live simultaneously. Users choose their
 *      version. No forced migrations. Safe rollbacks.
 *
 *      Version lifecycle: BETA → STABLE → DEPRECATED → SUNSET
 *
 *      When a version is sunset, users on that version are auto-migrated
 *      to the current default on their next interaction.
 *
 *      The router itself does NOT delegatecall — it's a routing registry.
 *      Protocol contracts query getImplementation(user) to determine
 *      which implementation to use for a given user's calls.
 */
contract VibeVersionRouter is Ownable, IVibeVersionRouter {

    // ============ State ============

    Version[] private _versions;
    mapping(address => uint256) private _implToVersionId; // impl → versionId + 1 (0 = not registered)
    mapping(address => uint256) private _userVersion;     // user → versionId + 1 (0 = use default)
    uint256 private _defaultVersionId;                    // current default version (internal ID + 1)
    uint16 private _versionCounter;

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ User Functions ============

    /**
     * @notice Select a specific version. Must be BETA or STABLE.
     */
    function selectVersion(uint256 versionId) external {
        if (versionId >= _versions.length) revert VersionNotFound();

        Version storage v = _versions[versionId];
        if (v.status == VersionStatus.SUNSET) revert VersionNotActive();

        _userVersion[msg.sender] = versionId + 1;
        emit UserVersionSelected(msg.sender, versionId);
    }

    // ============ Admin Functions ============

    /**
     * @notice Register a new implementation version.
     * @param implementation Contract address
     * @param label Human-readable label (e.g., "v2.0-stable")
     */
    function registerVersion(
        address implementation,
        string calldata label
    ) external onlyOwner {
        if (implementation == address(0)) revert ZeroAddress();
        if (_implToVersionId[implementation] != 0) revert DuplicateImplementation();

        uint256 versionId = _versions.length;
        _versionCounter++;

        _versions.push(Version({
            implementation: implementation,
            status: VersionStatus.BETA,
            registeredAt: uint40(block.timestamp),
            deprecatedAt: 0,
            versionNumber: _versionCounter,
            label: label
        }));

        _implToVersionId[implementation] = versionId + 1;

        // Auto-set as default if it's the first version
        if (_defaultVersionId == 0) {
            _defaultVersionId = versionId + 1;
            emit DefaultVersionUpdated(versionId);
        }

        emit VersionRegistered(versionId, implementation, _versionCounter, label);
    }

    /**
     * @notice Update a version's lifecycle status.
     *         Valid transitions: BETA→STABLE, STABLE→DEPRECATED, DEPRECATED→SUNSET
     *         Use sunsetVersion() for the SUNSET transition.
     */
    function setVersionStatus(uint256 versionId, VersionStatus status) external onlyOwner {
        if (versionId >= _versions.length) revert VersionNotFound();

        Version storage v = _versions[versionId];

        // Validate transitions
        if (v.status == VersionStatus.BETA && status != VersionStatus.STABLE) revert InvalidVersionTransition();
        if (v.status == VersionStatus.STABLE && status != VersionStatus.DEPRECATED) revert InvalidVersionTransition();
        if (v.status == VersionStatus.DEPRECATED) revert InvalidVersionTransition(); // use sunsetVersion
        if (v.status == VersionStatus.SUNSET) revert VersionAlreadySunset();

        v.status = status;

        if (status == VersionStatus.DEPRECATED) {
            v.deprecatedAt = uint40(block.timestamp);
        }

        emit VersionStatusUpdated(versionId, status);
    }

    /**
     * @notice Set the default version for new users. Must be STABLE.
     */
    function setDefaultVersion(uint256 versionId) external onlyOwner {
        if (versionId >= _versions.length) revert VersionNotFound();
        if (_versions[versionId].status != VersionStatus.STABLE) revert VersionNotActive();

        _defaultVersionId = versionId + 1;
        emit DefaultVersionUpdated(versionId);
    }

    /**
     * @notice Sunset a deprecated version. Users auto-migrate on next interaction.
     */
    function sunsetVersion(uint256 versionId) external onlyOwner {
        if (versionId >= _versions.length) revert VersionNotFound();
        Version storage v = _versions[versionId];
        if (v.status == VersionStatus.SUNSET) revert VersionAlreadySunset();

        v.status = VersionStatus.SUNSET;
        emit VersionSunset(versionId);
        emit VersionStatusUpdated(versionId, VersionStatus.SUNSET);
    }

    // ============ View Functions ============

    function getVersion(uint256 versionId) external view returns (Version memory) {
        if (versionId >= _versions.length) revert VersionNotFound();
        return _versions[versionId];
    }

    function totalVersions() external view returns (uint256) {
        return _versions.length;
    }

    function defaultVersion() external view returns (uint256) {
        if (_defaultVersionId == 0) revert NoDefaultVersion();
        return _defaultVersionId - 1;
    }

    function userVersion(address user) external view returns (uint256) {
        uint256 stored = _userVersion[user];
        if (stored == 0) {
            if (_defaultVersionId == 0) revert NoDefaultVersion();
            return _defaultVersionId - 1;
        }

        uint256 vId = stored - 1;
        // If user's version is sunset, return default
        if (_versions[vId].status == VersionStatus.SUNSET) {
            if (_defaultVersionId == 0) revert NoDefaultVersion();
            return _defaultVersionId - 1;
        }

        return vId;
    }

    /**
     * @notice Get the implementation address for a user.
     *         If user's selected version is sunset, auto-migrate to default.
     */
    function getImplementation(address user) external view returns (address) {
        uint256 stored = _userVersion[user];
        uint256 vId;

        if (stored == 0) {
            if (_defaultVersionId == 0) revert NoDefaultVersion();
            vId = _defaultVersionId - 1;
        } else {
            vId = stored - 1;
            if (_versions[vId].status == VersionStatus.SUNSET) {
                if (_defaultVersionId == 0) revert NoDefaultVersion();
                vId = _defaultVersionId - 1;
            }
        }

        return _versions[vId].implementation;
    }

    /**
     * @notice Find the latest STABLE version.
     */
    function latestStableVersion() external view returns (uint256) {
        for (uint256 i = _versions.length; i > 0; i--) {
            if (_versions[i - 1].status == VersionStatus.STABLE) {
                return i - 1;
            }
        }
        revert VersionNotFound();
    }
}
