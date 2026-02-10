// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./LamportLib.sol";

/**
 * @title QuantumGuard
 * @notice Mixin contract that adds quantum-resistant authorization to any contract
 * @dev Inherit this to add optional quantum signature requirements
 *
 * Usage:
 * 1. Inherit QuantumGuard in your contract
 * 2. Call _initQuantumGuard() in your initializer
 * 3. Use _requireQuantumAuth() modifier or check manually
 * 4. Users register quantum keys via registerQuantumKey()
 */
abstract contract QuantumGuard {
    using LamportLib for *;

    // ============ Structs ============

    struct QuantumKeySet {
        bytes32 merkleRoot;       // Merkle root of public key hashes
        uint256 totalKeys;        // Total keys in tree
        uint256 usedKeyBitmap;    // Bitmap of used keys (up to 256)
        uint256 usedCount;        // Total used count
        uint48 registeredAt;      // Registration timestamp
        uint48 lastUsed;          // Last usage timestamp
        bool active;              // Whether quantum auth is enabled
        bool required;            // Whether quantum auth is mandatory for this user
    }

    struct QuantumProof {
        uint256 keyIndex;                    // Which key in the Merkle tree
        bytes32 publicKeyHash;               // Hash of the Lamport public key
        bytes32[] merkleProof;               // Proof of inclusion
        LamportLib.Signature signature;      // The Lamport signature
        bytes32[256] oppositeHashes;         // Public key hashes for opposite bits
    }

    // ============ Storage ============

    /// @notice Quantum key configuration per user
    mapping(address => QuantumKeySet) internal _quantumKeys;

    /// @notice Used key tracking: keccak256(user, keyIndex) => used
    mapping(bytes32 => bool) internal _usedQuantumKeys;

    /// @notice Global quantum threshold (operations above this require quantum auth)
    uint256 internal _quantumThreshold;

    /// @notice Domain separator for structured messages
    bytes32 internal _quantumDomainSeparator;

    // ============ Events ============

    event QuantumKeyRegistered(
        address indexed user,
        bytes32 merkleRoot,
        uint256 totalKeys,
        bool required
    );

    event QuantumKeyRotated(address indexed user, bytes32 newMerkleRoot, uint256 newTotalKeys);
    event QuantumKeyRevoked(address indexed user);
    event QuantumAuthVerified(address indexed user, uint256 keyIndex, bytes32 messageHash);
    event QuantumRequirementSet(address indexed user, bool required);

    // ============ Errors ============

    error QuantumKeyNotRegistered();
    error QuantumKeyNotActive();
    error QuantumKeyAlreadyUsed();
    error QuantumKeyExhausted();
    error InvalidQuantumProof();
    error QuantumAuthRequired();
    error QuantumRevokeCooldown();
    error InvalidKeyCount();

    // ============ Initialization ============

    function _initQuantumGuard(uint256 threshold, string memory name) internal {
        _quantumThreshold = threshold;
        _quantumDomainSeparator = keccak256(
            abi.encode(
                keccak256("QuantumGuard(string name,uint256 chainId,address contract)"),
                keccak256(bytes(name)),
                block.chainid,
                address(this)
            )
        );
    }

    // ============ Key Management ============

    /**
     * @notice Register a quantum key set
     * @param merkleRoot Merkle root of Lamport public key hashes
     * @param totalKeys Number of keys (must be power of 2, max 256)
     * @param required Whether quantum auth should be mandatory
     */
    function registerQuantumKey(
        bytes32 merkleRoot,
        uint256 totalKeys,
        bool required
    ) external virtual {
        if (totalKeys == 0 || totalKeys > 256) revert InvalidKeyCount();
        if (totalKeys & (totalKeys - 1) != 0) revert InvalidKeyCount(); // Must be power of 2

        _quantumKeys[msg.sender] = QuantumKeySet({
            merkleRoot: merkleRoot,
            totalKeys: totalKeys,
            usedKeyBitmap: 0,
            usedCount: 0,
            registeredAt: uint48(block.timestamp),
            lastUsed: 0,
            active: true,
            required: required
        });

        emit QuantumKeyRegistered(msg.sender, merkleRoot, totalKeys, required);
    }

    /**
     * @notice Rotate to new quantum keys
     * @param newMerkleRoot New Merkle root
     * @param newTotalKeys New key count
     */
    function rotateQuantumKey(bytes32 newMerkleRoot, uint256 newTotalKeys) external virtual {
        QuantumKeySet storage qk = _quantumKeys[msg.sender];
        if (!qk.active) revert QuantumKeyNotActive();
        if (newTotalKeys == 0 || newTotalKeys > 256) revert InvalidKeyCount();
        if (newTotalKeys & (newTotalKeys - 1) != 0) revert InvalidKeyCount();

        qk.merkleRoot = newMerkleRoot;
        qk.totalKeys = newTotalKeys;
        qk.usedKeyBitmap = 0;
        qk.usedCount = 0;
        qk.registeredAt = uint48(block.timestamp);

        emit QuantumKeyRotated(msg.sender, newMerkleRoot, newTotalKeys);
    }

    /**
     * @notice Revoke quantum key (7 day cooldown)
     */
    function revokeQuantumKey() external virtual {
        QuantumKeySet storage qk = _quantumKeys[msg.sender];
        if (!qk.active) revert QuantumKeyNotActive();
        if (block.timestamp < qk.registeredAt + 7 days) revert QuantumRevokeCooldown();

        qk.active = false;
        emit QuantumKeyRevoked(msg.sender);
    }

    /**
     * @notice Set whether quantum auth is required for a user
     */
    function setQuantumRequired(bool required) external virtual {
        QuantumKeySet storage qk = _quantumKeys[msg.sender];
        if (!qk.active) revert QuantumKeyNotActive();

        qk.required = required;
        emit QuantumRequirementSet(msg.sender, required);
    }

    // ============ Verification ============

    /**
     * @notice Verify a quantum proof for a message
     * @param user The user to verify for
     * @param messageHash The message hash that was signed
     * @param proof The quantum proof containing signature and Merkle proof
     * @return valid True if valid
     */
    function verifyQuantumProof(
        address user,
        bytes32 messageHash,
        QuantumProof calldata proof
    ) public view returns (bool valid) {
        QuantumKeySet storage qk = _quantumKeys[user];
        if (!qk.active) return false;

        // Check key hasn't been used
        if (proof.keyIndex >= qk.totalKeys) return false;
        if (qk.usedKeyBitmap & (1 << proof.keyIndex) != 0) return false;

        // Verify Merkle proof
        bytes32 leaf = proof.publicKeyHash;
        bytes32 computedRoot = leaf;
        for (uint256 i = 0; i < proof.merkleProof.length; i++) {
            bytes32 proofElement = proof.merkleProof[i];
            if (proof.keyIndex & (1 << i) == 0) {
                computedRoot = keccak256(abi.encodePacked(computedRoot, proofElement));
            } else {
                computedRoot = keccak256(abi.encodePacked(proofElement, computedRoot));
            }
        }
        if (computedRoot != qk.merkleRoot) return false;

        // Verify Lamport signature
        return LamportLib.verifyWithHash(
            messageHash,
            proof.signature,
            proof.publicKeyHash,
            proof.oppositeHashes
        );
    }

    /**
     * @notice Verify and consume a quantum proof (marks key as used)
     */
    function _verifyAndConsumeQuantumProof(
        address user,
        bytes32 messageHash,
        QuantumProof calldata proof
    ) internal returns (bool valid) {
        if (!verifyQuantumProof(user, messageHash, proof)) {
            revert InvalidQuantumProof();
        }

        // Mark key as used
        QuantumKeySet storage qk = _quantumKeys[user];
        qk.usedKeyBitmap |= (1 << proof.keyIndex);
        qk.usedCount++;
        qk.lastUsed = uint48(block.timestamp);

        // Track globally too (for key reuse across rotations)
        bytes32 keyId = keccak256(abi.encodePacked(user, qk.merkleRoot, proof.keyIndex));
        _usedQuantumKeys[keyId] = true;

        emit QuantumAuthVerified(user, proof.keyIndex, messageHash);

        return true;
    }

    /**
     * @notice Create message hash for quantum signing
     */
    function getQuantumMessageHash(bytes memory data) public view returns (bytes32) {
        return LamportLib.hashStructuredMessage(_quantumDomainSeparator, data);
    }

    // ============ View Functions ============

    function hasQuantumKey(address user) public view returns (bool) {
        return _quantumKeys[user].active;
    }

    function isQuantumRequired(address user) public view returns (bool) {
        return _quantumKeys[user].active && _quantumKeys[user].required;
    }

    function quantumKeysRemaining(address user) public view returns (uint256) {
        QuantumKeySet storage qk = _quantumKeys[user];
        if (!qk.active) return 0;
        return qk.totalKeys - qk.usedCount;
    }

    function getQuantumKeyInfo(address user) public view returns (
        bytes32 merkleRoot,
        uint256 totalKeys,
        uint256 usedCount,
        uint256 registeredAt,
        bool active,
        bool required
    ) {
        QuantumKeySet storage qk = _quantumKeys[user];
        return (
            qk.merkleRoot,
            qk.totalKeys,
            qk.usedCount,
            qk.registeredAt,
            qk.active,
            qk.required
        );
    }

    // ============ Modifiers ============

    /**
     * @notice Require quantum auth if user has it enabled and required
     */
    modifier requireQuantumAuth(bytes32 messageHash, QuantumProof calldata proof) {
        if (isQuantumRequired(msg.sender)) {
            _verifyAndConsumeQuantumProof(msg.sender, messageHash, proof);
        }
        _;
    }

    /**
     * @notice Require quantum auth if amount exceeds threshold
     */
    modifier requireQuantumAuthAboveThreshold(
        uint256 amount,
        bytes32 messageHash,
        QuantumProof calldata proof
    ) {
        if (amount >= _quantumThreshold && hasQuantumKey(msg.sender)) {
            _verifyAndConsumeQuantumProof(msg.sender, messageHash, proof);
        }
        _;
    }
}
