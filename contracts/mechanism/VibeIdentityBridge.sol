// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeIdentityBridge — Cross-Chain Identity Portability
 * @notice Carry your reputation, identity, and mind score across chains.
 *         Attestation-based identity bridging via Trinity consensus.
 */
contract VibeIdentityBridge is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    struct IdentityAttestation {
        bytes32 attestationId;
        address account;
        uint256 sourceChainId;
        uint256 reputationScore;
        uint256 mindScore;
        bytes32 vibeCodeHash;       // VibeCode identity fingerprint
        bytes32 contributionRoot;   // ContributionDAG Merkle root
        uint256 attestedAt;
        uint256 validUntil;
        uint256 validatorCount;
        bool valid;
    }

    // ============ State ============

    mapping(bytes32 => IdentityAttestation) public attestations;
    mapping(address => bytes32) public latestAttestation;

    mapping(address => bool) public validators;
    mapping(bytes32 => mapping(address => bool)) public hasValidated;

    uint256 public requiredValidations;
    uint256 public attestationCount;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event AttestationCreated(bytes32 indexed attestationId, address indexed account, uint256 sourceChain);
    event AttestationValidated(bytes32 indexed attestationId, address indexed validator);
    event AttestationFinalized(bytes32 indexed attestationId);
    event IdentityImported(address indexed account, uint256 reputationScore, uint256 mindScore);

    // ============ Init ============

    function initialize(uint256 _requiredValidations) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        requiredValidations = _requiredValidations;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Attestation ============

    function createAttestation(
        address account,
        uint256 sourceChainId,
        uint256 reputationScore,
        uint256 mindScore,
        bytes32 vibeCodeHash,
        bytes32 contributionRoot,
        uint256 validityPeriod
    ) external returns (bytes32) {
        require(validators[msg.sender], "Not validator");

        attestationCount++;
        bytes32 attId = keccak256(abi.encodePacked(account, sourceChainId, attestationCount));

        attestations[attId] = IdentityAttestation({
            attestationId: attId,
            account: account,
            sourceChainId: sourceChainId,
            reputationScore: reputationScore,
            mindScore: mindScore,
            vibeCodeHash: vibeCodeHash,
            contributionRoot: contributionRoot,
            attestedAt: block.timestamp,
            validUntil: block.timestamp + validityPeriod,
            validatorCount: 1,
            valid: false
        });

        hasValidated[attId][msg.sender] = true;
        emit AttestationCreated(attId, account, sourceChainId);

        if (requiredValidations == 1) {
            attestations[attId].valid = true;
            latestAttestation[account] = attId;
            emit AttestationFinalized(attId);
            emit IdentityImported(account, reputationScore, mindScore);
        }

        return attId;
    }

    function validateAttestation(bytes32 attId) external {
        require(validators[msg.sender], "Not validator");
        require(!hasValidated[attId][msg.sender], "Already validated");

        hasValidated[attId][msg.sender] = true;
        attestations[attId].validatorCount++;

        emit AttestationValidated(attId, msg.sender);

        if (attestations[attId].validatorCount >= requiredValidations) {
            attestations[attId].valid = true;
            latestAttestation[attestations[attId].account] = attId;
            emit AttestationFinalized(attId);
            emit IdentityImported(
                attestations[attId].account,
                attestations[attId].reputationScore,
                attestations[attId].mindScore
            );
        }
    }

    // ============ Admin ============

    function addValidator(address v) external onlyOwner {
        validators[v] = true;
    }

    function removeValidator(address v) external onlyOwner {
        validators[v] = false;
    }

    // ============ View ============

    function getIdentity(address account) external view returns (
        uint256 reputationScore, uint256 mindScore, bytes32 vibeCodeHash, bool valid
    ) {
        bytes32 attId = latestAttestation[account];
        IdentityAttestation storage att = attestations[attId];
        return (att.reputationScore, att.mindScore, att.vibeCodeHash, att.valid && block.timestamp <= att.validUntil);
    }

    function isValidIdentity(address account) external view returns (bool) {
        bytes32 attId = latestAttestation[account];
        return attestations[attId].valid && block.timestamp <= attestations[attId].validUntil;
    }
}
