// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ICredentialRegistry
 * @notice On-chain registry for behavioral credentials (W3C Verifiable Credential hashes).
 * @dev Mirrors cogproof/src/credentials/credential-registry.js.
 *      Full credentials live off-chain; only hashes land here.
 *      Score accumulates from credential weights; tiers derived from score.
 *
 *      CogProof JS origin: cogproof/src/credentials/credential-registry.js
 *      See: docs/COGPROOF_INTEGRATION.md for full parameter crosswalk.
 */
interface ICredentialRegistry {
    // ============ Enums ============

    /// @notice Credential types matching CogProof's CREDENTIAL_TYPES
    enum CredentialType {
        BATCH_PARTICIPANT,       // weight: +1  — committed to a batch
        HONEST_REVEAL,           // weight: +2  — reveal matched commit hash
        FAIR_EXECUTION,          // weight: +2  — included in shuffled execution
        FAILED_REVEAL,           // weight: -3  — committed but didn't reveal
        HIGH_CONTRIBUTOR,        // weight: +5  — Shapley value top 20%
        CONSISTENT_CONTRIBUTOR,  // weight: +10 — positive Shapley across 10+ batches
        COMPRESSION_MINER,       // weight: +3  — valid lossless compression PoW
        HIGH_DENSITY_MINER,      // weight: +5  — compression density > 0.8
        REPUTATION_BURN          // weight: +4  — burned tokens to endorse someone
    }

    /// @notice Reputation tiers matching CogProof's _computeTier
    enum ReputationTier {
        FLAGGED,    // score < 0
        NEWCOMER,   // score 0-4
        BRONZE,     // score 5-14
        SILVER,     // score 15-29
        GOLD,       // score 30-49
        DIAMOND     // score >= 50
    }

    // ============ Structs ============

    struct CredentialRecord {
        bytes32 credentialHash;   // sha256 of the full W3C VC JSON
        address subject;
        CredentialType credType;
        uint64 issuedAt;
        bytes32 batchContext;     // batch ID or other context reference
    }

    // ============ Events ============

    event CredentialIssued(
        bytes32 indexed credentialHash,
        address indexed subject,
        CredentialType indexed credType,
        bytes32 batchContext
    );

    event IssuerAuthorized(address indexed issuer);
    event IssuerRevoked(address indexed issuer);

    // ============ Errors ============

    error NotAuthorizedIssuer();
    error CredentialAlreadyExists();
    error InvalidCredentialType();

    // ============ Functions ============

    function issueCredential(
        address subject,
        CredentialType credType,
        bytes32 credentialHash,
        bytes32 batchContext
    ) external;

    function getUserScore(address user) external view returns (int256 score);
    function getUserTier(address user) external view returns (ReputationTier tier);
    function getCredentialCount(address user) external view returns (uint256);
    function verifyCredential(bytes32 credentialHash) external view returns (bool exists);
}
