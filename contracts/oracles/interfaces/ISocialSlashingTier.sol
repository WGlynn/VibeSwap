// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISocialSlashingTier
 * @notice C12 — stub interface for community-evidence-based slashing. Opt-in
 *         fallback tier for when automated detection is insufficient. NOT
 *         active by default — `enabled` defaults to false and requires
 *         governance to activate. Kept as a stub so the hook exists without
 *         committing to an implementation path in C12.
 * @dev Activation deferred to C13+ via DAO. Until then, all state-changing
 *      methods revert with SocialSlashingDisabled. This preserves the
 *      "radical transparency" default and prevents emergency-brake capture.
 */
interface ISocialSlashingTier {
    event SocialSlashProposed(bytes32 indexed proposalId, bytes32 indexed issuerKey, bytes32 evidenceCid, uint256 deadline);
    event SocialSlashVoted(bytes32 indexed proposalId, address indexed voter, bool support, uint256 weight);
    event SocialSlashExecuted(bytes32 indexed proposalId, bytes32 indexed issuerKey, uint256 bpsSlashed);
    event SocialSlashingEnabledChanged(bool enabled);

    error SocialSlashingDisabled();

    function enabled() external view returns (bool);

    function proposeSocialSlash(bytes32 issuerKey, bytes32 evidenceCid, uint256 votingDeadline)
        external
        returns (bytes32 proposalId);

    function voteSocialSlash(bytes32 proposalId, bool support) external;

    function executeSocialSlash(bytes32 proposalId) external;
}
