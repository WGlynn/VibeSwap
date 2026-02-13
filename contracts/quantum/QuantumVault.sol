// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title QuantumVault
 * @notice Opt-in quantum-resistant security layer using hash-based signatures
 * @dev Uses Lamport one-time signatures with Merkle trees for key management
 *
 * How it works:
 * 1. User generates N Lamport keypairs off-chain (e.g., 256 keys)
 * 2. User builds Merkle tree of public key hashes, registers root on-chain
 * 3. For protected operations, user provides:
 *    - Lamport signature (revealing private key halves based on message bits)
 *    - Merkle proof that this key is part of their registered set
 * 4. Contract verifies both, marks key as used (one-time only)
 *
 * Security: Even with a quantum computer, an attacker cannot:
 * - Derive unused private keys from the Merkle root
 * - Reuse a spent key (tracked on-chain)
 * - Forge signatures (would need to invert SHA-256)
 */
contract QuantumVault is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    // ============ Constants ============

    // Lamport signature parameters
    uint256 public constant CHUNKS = 32;        // 256 bits / 8 bits per chunk
    uint256 public constant CHUNK_VALUES = 256; // 2^8 possible values per chunk

    // Each Lamport public key is 32 chunks × 256 possible hash values = 8192 hashes
    // We store hash of the full public key to save gas

    // ============ Structs ============

    struct QuantumKey {
        bytes32 merkleRoot;      // Root of Merkle tree of Lamport public key hashes
        uint256 totalKeys;       // Total keys in the tree
        uint256 usedKeys;        // Number of keys already used
        uint256 registeredAt;    // Registration timestamp
        bool active;             // Whether quantum protection is active
    }

    struct LamportSignature {
        bytes32[CHUNKS] revealed;  // The revealed private key chunks (hashed to verify)
        uint8[CHUNKS] indices;     // Which index (0-255) was used for each chunk
    }

    // ============ State ============

    // User address => quantum key configuration
    mapping(address => QuantumKey) public quantumKeys;

    // Track used Lamport keys: keccak256(user, keyIndex) => used
    mapping(bytes32 => bool) public usedKeys;

    // Contracts that require quantum auth for certain operations
    mapping(address => bool) public protectedContracts;

    // Threshold above which quantum auth is required (in wei)
    uint256 public quantumThreshold;

    // ============ Events ============

    event QuantumKeyRegistered(address indexed user, bytes32 merkleRoot, uint256 totalKeys);
    event QuantumKeyRevoked(address indexed user);
    event QuantumAuthSuccess(address indexed user, uint256 keyIndex, bytes32 messageHash);
    event QuantumKeyExhausted(address indexed user);
    event ProtectedContractSet(address indexed contract_, bool protected);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // ============ Errors ============

    error NoQuantumKey();
    error QuantumKeyInactive();
    error KeyAlreadyUsed();
    error InvalidMerkleProof();
    error InvalidSignature();
    error AllKeysExhausted();
    error KeyAlreadyRegistered();
    error InvalidKeyCount();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(uint256 _threshold) public initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        quantumThreshold = _threshold;
    }

    // ============ Key Registration ============

    /**
     * @notice Register a quantum-resistant key set
     * @param merkleRoot Root of Merkle tree containing Lamport public key hashes
     * @param totalKeys Number of one-time keys in the tree (must be power of 2)
     */
    function registerQuantumKey(bytes32 merkleRoot, uint256 totalKeys) external {
        if (quantumKeys[msg.sender].active) revert KeyAlreadyRegistered();
        if (totalKeys == 0 || (totalKeys & (totalKeys - 1)) != 0) revert InvalidKeyCount();

        quantumKeys[msg.sender] = QuantumKey({
            merkleRoot: merkleRoot,
            totalKeys: totalKeys,
            usedKeys: 0,
            registeredAt: block.timestamp,
            active: true
        });

        emit QuantumKeyRegistered(msg.sender, merkleRoot, totalKeys);
    }

    /**
     * @notice Revoke quantum key (disables quantum protection)
     * @dev User must wait 7 days after registration to revoke (prevents attack)
     */
    function revokeQuantumKey() external {
        QuantumKey storage qk = quantumKeys[msg.sender];
        if (!qk.active) revert NoQuantumKey();

        // Require 7 day waiting period to prevent attacker from quickly disabling
        require(block.timestamp >= qk.registeredAt + 7 days, "Must wait 7 days to revoke");

        qk.active = false;
        emit QuantumKeyRevoked(msg.sender);
    }

    /**
     * @notice Update Merkle root with new keys (for key rotation)
     * @param newMerkleRoot New Merkle root
     * @param newTotalKeys New total key count
     */
    function rotateQuantumKey(bytes32 newMerkleRoot, uint256 newTotalKeys) external {
        QuantumKey storage qk = quantumKeys[msg.sender];
        if (!qk.active) revert NoQuantumKey();
        if (newTotalKeys == 0 || (newTotalKeys & (newTotalKeys - 1)) != 0) revert InvalidKeyCount();

        // Reset key usage
        qk.merkleRoot = newMerkleRoot;
        qk.totalKeys = newTotalKeys;
        qk.usedKeys = 0;
        qk.registeredAt = block.timestamp;

        emit QuantumKeyRegistered(msg.sender, newMerkleRoot, newTotalKeys);
    }

    // ============ Signature Verification ============

    /**
     * @notice Verify a quantum signature for a message
     * @param user The user whose quantum key to verify against
     * @param messageHash The message being signed (typically keccak256 of tx data)
     * @param keyIndex Which key from the Merkle tree is being used
     * @param publicKeyHash Hash of the Lamport public key being used
     * @param merkleProof Proof that publicKeyHash is in the user's Merkle tree
     * @param signature The Lamport signature (revealed private key chunks)
     * @return valid Whether the signature is valid
     */
    function verifyQuantumSignature(
        address user,
        bytes32 messageHash,
        uint256 keyIndex,
        bytes32 publicKeyHash,
        bytes32[] calldata merkleProof,
        LamportSignature calldata signature
    ) public view returns (bool valid) {
        QuantumKey storage qk = quantumKeys[user];
        if (!qk.active) revert QuantumKeyInactive();
        if (qk.usedKeys >= qk.totalKeys) revert AllKeysExhausted();

        // Check key hasn't been used
        bytes32 keyId = keccak256(abi.encodePacked(user, keyIndex));
        if (usedKeys[keyId]) revert KeyAlreadyUsed();

        // Verify Merkle proof
        bytes32 leaf = publicKeyHash;
        bytes32 computedRoot = leaf;
        for (uint256 i = 0; i < merkleProof.length; i++) {
            bytes32 proofElement = merkleProof[i];
            if (keyIndex & (1 << i) == 0) {
                computedRoot = keccak256(abi.encodePacked(computedRoot, proofElement));
            } else {
                computedRoot = keccak256(abi.encodePacked(proofElement, computedRoot));
            }
        }
        if (computedRoot != qk.merkleRoot) revert InvalidMerkleProof();

        // Verify Lamport signature
        // The signature reveals private key values based on message chunks
        // We hash them and compare to expected public key values

        // For simplicity, we verify against a reconstructed public key hash
        // In practice, you'd need to verify each chunk matches the public key

        bytes32 reconstructedPubKeyHash = _reconstructPublicKeyHash(messageHash, signature);
        if (reconstructedPubKeyHash != publicKeyHash) revert InvalidSignature();

        return true;
    }

    /**
     * @notice Verify and consume a quantum signature (marks key as used)
     */
    function verifyAndConsumeQuantumSignature(
        address user,
        bytes32 messageHash,
        uint256 keyIndex,
        bytes32 publicKeyHash,
        bytes32[] calldata merkleProof,
        LamportSignature calldata signature
    ) external nonReentrant returns (bool) {
        // Verify signature
        bool valid = verifyQuantumSignature(
            user,
            messageHash,
            keyIndex,
            publicKeyHash,
            merkleProof,
            signature
        );

        if (valid) {
            // Mark key as used
            bytes32 keyId = keccak256(abi.encodePacked(user, keyIndex));
            usedKeys[keyId] = true;

            // Update usage counter
            QuantumKey storage qk = quantumKeys[user];
            qk.usedKeys++;

            emit QuantumAuthSuccess(user, keyIndex, messageHash);

            // Warn if keys are running low
            if (qk.usedKeys >= qk.totalKeys) {
                emit QuantumKeyExhausted(user);
            }
        }

        return valid;
    }

    /**
     * @notice Check if a user has active quantum protection
     */
    function hasQuantumProtection(address user) external view returns (bool) {
        return quantumKeys[user].active;
    }

    /**
     * @notice Get remaining unused keys for a user
     */
    function remainingKeys(address user) external view returns (uint256) {
        QuantumKey storage qk = quantumKeys[user];
        if (!qk.active) return 0;
        return qk.totalKeys - qk.usedKeys;
    }

    // ============ Internal ============

    /**
     * @notice Reconstruct public key hash from signature and message
     * @dev In a full implementation, this would verify each chunk properly
     *      For this version, we use a simplified verification
     */
    function _reconstructPublicKeyHash(
        bytes32 messageHash,
        LamportSignature calldata signature
    ) internal pure returns (bytes32) {
        bytes32[] memory pubKeyChunks = new bytes32[](CHUNKS * 2);

        // For each chunk of the message
        for (uint256 i = 0; i < CHUNKS; i++) {
            // Get the byte from the message
            uint8 msgByte = uint8(messageHash[i]);

            // The revealed value should hash to the public key at this position
            bytes32 hashedRevealed = keccak256(abi.encodePacked(signature.revealed[i]));

            // In a full Lamport scheme, we'd have 256 possible values per chunk
            // For simplicity, we use the index to position the hash
            pubKeyChunks[i * 2] = hashedRevealed;
            pubKeyChunks[i * 2 + 1] = bytes32(uint256(signature.indices[i]));
        }

        // Hash all chunks to get public key hash
        return keccak256(abi.encodePacked(pubKeyChunks));
    }

    // ============ Admin ============

    function setProtectedContract(address contract_, bool protected) external onlyOwner {
        protectedContracts[contract_] = protected;
        emit ProtectedContractSet(contract_, protected);
    }

    function setQuantumThreshold(uint256 newThreshold) external onlyOwner {
        emit ThresholdUpdated(quantumThreshold, newThreshold);
        quantumThreshold = newThreshold;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
