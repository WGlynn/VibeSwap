// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./interfaces/ICredentialRegistry.sol";

/**
 * @title CredentialRegistry — Behavioral Credentials On-Chain
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice On-chain store for CogProof behavioral credential hashes.
 *         Full W3C Verifiable Credentials live off-chain; this contract
 *         stores hashes and accumulates weighted reputation scores.
 *
 * @dev Mirrors cogproof/src/credentials/credential-registry.js.
 *      9 credential types with signed weights. Score accumulates additively.
 *      Tier thresholds match CogProof: DIAMOND(50), GOLD(30), SILVER(15), BRONZE(5).
 *
 *      CogProof JS origin: cogproof/src/credentials/credential-registry.js
 *      See: docs/COGPROOF_INTEGRATION.md
 *      P-000: Fairness Above All.
 */
contract CredentialRegistry is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    ICredentialRegistry
{
    // ============ Constants ============

    /// @notice Credential weights matching CogProof's CREDENTIAL_TYPES
    /// @dev Returns weight for a given CredentialType ordinal
    function _getWeight(uint8 credType) internal pure returns (int8) {
        if (credType == 0) return 1;   // BATCH_PARTICIPANT
        if (credType == 1) return 2;   // HONEST_REVEAL
        if (credType == 2) return 2;   // FAIR_EXECUTION
        if (credType == 3) return -3;  // FAILED_REVEAL
        if (credType == 4) return 5;   // HIGH_CONTRIBUTOR
        if (credType == 5) return 10;  // CONSISTENT_CONTRIBUTOR
        if (credType == 6) return 3;   // COMPRESSION_MINER
        if (credType == 7) return 5;   // HIGH_DENSITY_MINER
        if (credType == 8) return 4;   // REPUTATION_BURN
        revert InvalidCredentialType();
    }

    /// @notice Tier thresholds matching CogProof's _computeTier
    int256 public constant DIAMOND_THRESHOLD = 50;
    int256 public constant GOLD_THRESHOLD = 30;
    int256 public constant SILVER_THRESHOLD = 15;
    int256 public constant BRONZE_THRESHOLD = 5;

    // ============ State ============

    /// @notice credential hash => record
    mapping(bytes32 => CredentialRecord) private _credentials;

    /// @notice user => accumulated weighted score
    mapping(address => int256) private _scores;

    /// @notice user => total credential count
    mapping(address => uint256) private _credentialCounts;

    /// @notice authorized issuers (BehavioralReputationVerifier, governance, etc.)
    mapping(address => bool) public authorizedIssuers;

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Admin ============

    function authorizeIssuer(address issuer) external onlyOwner {
        authorizedIssuers[issuer] = true;
        emit IssuerAuthorized(issuer);
    }

    function revokeIssuer(address issuer) external onlyOwner {
        authorizedIssuers[issuer] = false;
        emit IssuerRevoked(issuer);
    }

    // ============ Core ============

    /// @inheritdoc ICredentialRegistry
    function issueCredential(
        address subject,
        CredentialType credType,
        bytes32 credentialHash,
        bytes32 batchContext
    ) external override {
        if (!authorizedIssuers[msg.sender]) revert NotAuthorizedIssuer();
        if (_credentials[credentialHash].issuedAt != 0) revert CredentialAlreadyExists();
        if (uint8(credType) > 8) revert InvalidCredentialType();

        _credentials[credentialHash] = CredentialRecord({
            credentialHash: credentialHash,
            subject: subject,
            credType: credType,
            issuedAt: uint64(block.timestamp),
            batchContext: batchContext
        });

        // Accumulate weighted score
        int8 weight = _getWeight(uint8(credType));
        _scores[subject] += int256(weight);
        _credentialCounts[subject]++;

        emit CredentialIssued(credentialHash, subject, credType, batchContext);
    }

    // ============ Views ============

    /// @inheritdoc ICredentialRegistry
    function getUserScore(address user) external view override returns (int256 score) {
        return _scores[user];
    }

    /// @inheritdoc ICredentialRegistry
    function getUserTier(address user) external view override returns (ReputationTier tier) {
        return _computeTier(_scores[user]);
    }

    /// @inheritdoc ICredentialRegistry
    function getCredentialCount(address user) external view override returns (uint256) {
        return _credentialCounts[user];
    }

    /// @inheritdoc ICredentialRegistry
    function verifyCredential(bytes32 credentialHash) external view override returns (bool exists) {
        return _credentials[credentialHash].issuedAt != 0;
    }

    /// @notice Get full credential record
    function getCredential(bytes32 credentialHash) external view returns (CredentialRecord memory) {
        return _credentials[credentialHash];
    }

    /// @notice Get weight for a credential type
    function getCredentialWeight(CredentialType credType) external pure returns (int8) {
        return _getWeight(uint8(credType));
    }

    // ============ Internal ============

    /// @dev Tier computation matching CogProof's credential-registry.js _computeTier
    function _computeTier(int256 score) internal pure returns (ReputationTier) {
        if (score < 0) return ReputationTier.FLAGGED;
        if (score < BRONZE_THRESHOLD) return ReputationTier.NEWCOMER;
        if (score < SILVER_THRESHOLD) return ReputationTier.BRONZE;
        if (score < GOLD_THRESHOLD) return ReputationTier.SILVER;
        if (score < DIAMOND_THRESHOLD) return ReputationTier.GOLD;
        return ReputationTier.DIAMOND;
    }
}
