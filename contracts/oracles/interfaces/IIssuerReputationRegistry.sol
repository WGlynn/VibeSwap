// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IIssuerReputationRegistry
 * @notice Stake-bonded issuer identity for oracle evidence bundles.
 * @dev C12 — closes the "fabricated bundle contents" gap by adding an economic
 *      cost to fabrication. Issuers bond stake, post evidence bundles under a
 *      registered key, and lose stake + reputation on detected fabrication.
 */
interface IIssuerReputationRegistry {
    // ============ Enums ============

    enum IssuerStatus {
        UNREGISTERED,
        ACTIVE,
        UNBONDING,
        SLASHED_OUT  // reputation below MIN_REPUTATION
    }

    // ============ Events ============

    event IssuerRegistered(bytes32 indexed issuerKey, address indexed signer, uint256 stake);
    event IssuerSlashed(bytes32 indexed issuerKey, uint256 stakeSlashed, uint256 reputationAfter, string reason);
    event IssuerUnbondRequested(bytes32 indexed issuerKey, uint256 availableAt);
    event IssuerUnbonded(bytes32 indexed issuerKey, uint256 stakeReturned);
    event SlasherAuthorized(address indexed slasher, bool authorized);
    event ReputationDecayed(bytes32 indexed issuerKey, uint256 reputationBefore, uint256 reputationAfter);

    // ============ View ============

    /// @notice Returns true if issuerKey is currently active AND the recovered signer matches.
    function verifyIssuer(bytes32 issuerKey, address signer) external view returns (bool);

    function getIssuerStatus(bytes32 issuerKey)
        external
        view
        returns (
            IssuerStatus status,
            address signer,
            uint256 stake,
            uint256 reputation,
            uint256 unbondAvailableAt
        );

    function minStake() external view returns (uint256);
    function minReputation() external view returns (uint256);

    // ============ State-changing ============

    /// @notice Register as an issuer by bonding stake and binding a key to a signer.
    function registerIssuer(bytes32 issuerKey, address signer, uint256 stakeAmount) external;

    /// @notice Begin the unbonding delay. Stake becomes withdrawable after UNBOND_DELAY.
    function requestUnbond(bytes32 issuerKey) external;

    /// @notice Withdraw stake after unbond delay. Deactivates issuer.
    function completeUnbond(bytes32 issuerKey) external;

    /// @notice Slash an issuer. Permissioned — owner or authorized slasher.
    /// @param bpsSlash Fraction of remaining stake to burn (basis points, max 10000).
    function slashIssuer(bytes32 issuerKey, uint256 bpsSlash, string calldata reason) external;

    /// @notice Apply time-based reputation mean-reversion toward MID_REPUTATION.
    /// @dev Permissionless — anyone can call to refresh an issuer's reputation.
    function touchReputation(bytes32 issuerKey) external;
}
