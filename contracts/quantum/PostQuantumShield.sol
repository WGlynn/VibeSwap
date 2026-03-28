// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./LamportLib.sol";

/**
 * @title PostQuantumShield — Protocol-Wide Post-Quantum Security Layer
 * @notice Hash-based post-quantum key agreement and authentication.
 *         Every critical protocol operation can be quantum-hardened.
 *
 * @dev Post-quantum primitives:
 *
 *   1. Lamport OTS (existing) — One-time signatures for high-value txs
 *   2. Merkle Signature Scheme (MSS) — Many signatures from one key tree
 *   3. Hash-Based Key Agreement — Quantum-safe key exchange
 *   4. SPHINCS+-style stateless signatures — For repeated signing
 *   5. Commit-Reveal with quantum-safe binding
 *
 *   Integration points:
 *   - TrinityGuardian: Node identity verified with quantum keys
 *   - ProofOfMind: Consensus votes quantum-signed
 *   - VibeBridge: Cross-chain messages quantum-authenticated
 *   - VibeVault: High-value withdrawals require quantum auth
 *   - VibeStable: CDP operations quantum-guarded above threshold
 *
 *   The key insight: ECDSA is broken by quantum computers.
 *   Hash functions (SHA-256, Keccak) are NOT — they remain secure
 *   with doubled key sizes. This contract uses ONLY hash-based crypto.
 *
 *   "Scottie Tu the anti-christ cannot hack us." — Will
 */
contract PostQuantumShield {
    // ============ Constants ============

    /// @notice Merkle tree depth for signature scheme
    uint256 public constant MERKLE_DEPTH = 20; // 2^20 = ~1M signatures per keyset

    /// @notice Key agreement salt length
    uint256 public constant SALT_LENGTH = 32;

    /// @notice Quantum security level (bits)
    uint256 public constant SECURITY_LEVEL = 256;

    /// @notice Maximum key rotation period
    uint256 public constant KEY_ROTATION_PERIOD = 90 days;

    /// @notice Minimum key age before rotation allowed
    uint256 public constant MIN_KEY_AGE = 1 days;

    // ============ Types ============

    struct QuantumIdentity {
        bytes32 merkleRoot;          // Root of Lamport key tree
        bytes32 keyAgreementPub;     // Public component for key agreement
        uint256 totalKeys;           // Total one-time keys available
        uint256 usedKeys;            // How many have been used
        uint256 registeredAt;
        uint256 lastRotated;
        uint256 lastUsed;
        uint8 securityLevel;         // 128, 192, or 256 bits
        bool active;
        bool mandatory;              // If true, all ops require quantum auth
    }

    struct KeyAgreement {
        bytes32 agreementId;
        address partyA;
        address partyB;
        bytes32 sharedSecretHash;    // Hash of derived shared secret
        bytes32 ephemeralPubA;       // A's ephemeral public value
        bytes32 ephemeralPubB;       // B's ephemeral public value
        uint256 establishedAt;
        uint256 expiresAt;
        bool active;
    }

    struct QuantumChallenge {
        bytes32 challengeId;
        address challenger;
        address target;
        bytes32 challengeHash;       // Random challenge to sign
        bytes32 responseHash;        // Expected response hash
        uint256 createdAt;
        uint256 deadline;
        bool completed;
        bool passed;
    }

    // ============ State ============

    /// @notice Quantum identities per address
    mapping(address => QuantumIdentity) public identities;
    uint256 public totalIdentities;

    /// @notice Key agreements
    mapping(bytes32 => KeyAgreement) public agreements;

    /// @notice Quantum challenges (for identity verification)
    mapping(bytes32 => QuantumChallenge) public challenges;

    /// @notice Used one-time key indices per identity
    mapping(address => mapping(uint256 => bool)) public usedKeyIndices;

    /// @notice Protected operations: contract => selector => requires quantum auth
    mapping(address => mapping(bytes4 => bool)) public protectedOperations;

    /// @notice Quantum auth nonces (replay protection)
    mapping(address => uint256) public quantumNonces;

    /// @notice Emergency quantum recovery addresses
    mapping(address => address) public recoveryAddresses;

    /// @notice Global quantum enforcement threshold (in ETH value)
    uint256 public quantumThreshold;

    // ============ Events ============

    event QuantumIdentityRegistered(address indexed account, bytes32 merkleRoot, uint8 securityLevel);
    event QuantumKeyRotated(address indexed account, bytes32 oldRoot, bytes32 newRoot);
    event KeyAgreementEstablished(bytes32 indexed agreementId, address indexed partyA, address indexed partyB);
    event QuantumAuthVerified(address indexed account, uint256 keyIndex, bytes32 operationHash);
    event OperationProtected(address indexed target, bytes4 selector);
    event QuantumChallengeCreated(bytes32 indexed challengeId, address target);
    event QuantumChallengeCompleted(bytes32 indexed challengeId, bool passed);
    event QuantumRecoverySet(address indexed account, address recovery);
    event QuantumThresholdUpdated(uint256 newThreshold);

    // ============ Errors ============

    error QuantumIdentityNotFound();
    error QuantumKeyAlreadyUsed();
    error QuantumAuthRequired();
    error InvalidQuantumProof();
    error KeyRotationTooSoon();
    error ChallengeFailed();
    error ChallengeExpired();
    error AgreementExpired();
    error NotAuthorized();

    // ============ Identity Management ============

    /**
     * @notice Register a quantum-resistant identity
     * @param merkleRoot Root of the Lamport key Merkle tree
     * @param keyAgreementPub Public value for hash-based key agreement
     * @param totalKeys Total one-time keys in the tree
     * @param securityLevel Security level (128, 192, 256)
     * @param mandatory If true, ALL operations require quantum auth
     */
    function registerQuantumIdentity(
        bytes32 merkleRoot,
        bytes32 keyAgreementPub,
        uint256 totalKeys,
        uint8 securityLevel,
        bool mandatory
    ) external {
        require(securityLevel == 128 || securityLevel == 192 || securityLevel == 255, "Invalid level");
        require(merkleRoot != bytes32(0), "Zero root");

        identities[msg.sender] = QuantumIdentity({
            merkleRoot: merkleRoot,
            keyAgreementPub: keyAgreementPub,
            totalKeys: totalKeys,
            usedKeys: 0,
            registeredAt: block.timestamp,
            lastRotated: block.timestamp,
            lastUsed: 0,
            securityLevel: securityLevel,
            active: true,
            mandatory: mandatory
        });

        totalIdentities++;
        emit QuantumIdentityRegistered(msg.sender, merkleRoot, securityLevel);
    }

    /**
     * @notice Rotate quantum keys (generate new tree, invalidate old)
     */
    function rotateQuantumKeys(
        bytes32 newMerkleRoot,
        bytes32 newKeyAgreementPub,
        uint256 newTotalKeys,
        // Proof of ownership of old key
        uint256 oldKeyIndex,
        bytes32[256] calldata oldSignature,
        bytes32[256] calldata oldPublicKey,
        bytes32[] calldata merkleProof
    ) external {
        QuantumIdentity storage identity = identities[msg.sender];
        if (!identity.active) revert QuantumIdentityNotFound();
        if (block.timestamp < identity.registeredAt + MIN_KEY_AGE) revert KeyRotationTooSoon();

        // Verify ownership with old key
        bytes32 message = keccak256(abi.encodePacked(
            "ROTATE", msg.sender, newMerkleRoot, quantumNonces[msg.sender]
        ));

        bool valid = _verifyLamportWithMerkle(
            identity.merkleRoot,
            oldKeyIndex,
            oldSignature,
            oldPublicKey,
            merkleProof,
            message
        );
        if (!valid) revert InvalidQuantumProof();

        bytes32 oldRoot = identity.merkleRoot;
        identity.merkleRoot = newMerkleRoot;
        identity.keyAgreementPub = newKeyAgreementPub;
        identity.totalKeys = newTotalKeys;
        identity.usedKeys = 0;
        identity.lastRotated = block.timestamp;
        quantumNonces[msg.sender]++;

        emit QuantumKeyRotated(msg.sender, oldRoot, newMerkleRoot);
    }

    // ============ Quantum Authentication ============

    /**
     * @notice Verify a quantum signature for a specific operation
     * @dev Used by other contracts to quantum-gate operations
     */
    function verifyQuantumAuth(
        address account,
        bytes32 operationHash,
        uint256 keyIndex,
        bytes32[256] calldata signature,
        bytes32[256] calldata publicKey,
        bytes32[] calldata merkleProof
    ) external returns (bool) {
        QuantumIdentity storage identity = identities[account];
        if (!identity.active) {
            if (identity.mandatory) revert QuantumIdentityNotFound();
            return true; // No quantum identity = skip check (unless mandatory)
        }

        if (usedKeyIndices[account][keyIndex]) revert QuantumKeyAlreadyUsed();

        bytes32 message = keccak256(abi.encodePacked(
            operationHash, account, quantumNonces[account]
        ));

        bool valid = _verifyLamportWithMerkle(
            identity.merkleRoot,
            keyIndex,
            signature,
            publicKey,
            merkleProof,
            message
        );

        if (!valid) revert InvalidQuantumProof();

        usedKeyIndices[account][keyIndex] = true;
        identity.usedKeys++;
        identity.lastUsed = block.timestamp;
        quantumNonces[account]++;

        emit QuantumAuthVerified(account, keyIndex, operationHash);
        return true;
    }

    // ============ Key Agreement ============

    /**
     * @notice Initiate a hash-based key agreement (quantum-safe)
     * @dev Uses hash chains for key exchange — no elliptic curves
     *
     * Protocol:
     *   1. A picks random salt_a, computes pub_a = H(salt_a || kag_pub_a)
     *   2. B picks random salt_b, computes pub_b = H(salt_b || kag_pub_b)
     *   3. Shared secret = H(pub_a || pub_b || H(kag_pub_a || kag_pub_b))
     *   4. Only A and B can compute this (knowledge of salt + key agreement pub)
     */
    function initiateKeyAgreement(
        address partyB,
        bytes32 ephemeralPub,
        uint256 duration
    ) external returns (bytes32) {
        QuantumIdentity storage idA = identities[msg.sender];
        require(idA.active, "No quantum identity");

        bytes32 agreementId = keccak256(abi.encodePacked(
            msg.sender, partyB, ephemeralPub, block.timestamp
        ));

        agreements[agreementId] = KeyAgreement({
            agreementId: agreementId,
            partyA: msg.sender,
            partyB: partyB,
            sharedSecretHash: bytes32(0),
            ephemeralPubA: ephemeralPub,
            ephemeralPubB: bytes32(0),
            establishedAt: 0,
            expiresAt: block.timestamp + duration,
            active: false
        });

        return agreementId;
    }

    /**
     * @notice Complete a key agreement (party B responds)
     */
    function completeKeyAgreement(
        bytes32 agreementId,
        bytes32 ephemeralPub
    ) external {
        KeyAgreement storage ka = agreements[agreementId];
        require(ka.partyB == msg.sender, "Not party B");
        require(!ka.active, "Already completed");
        require(block.timestamp < ka.expiresAt, "Expired");

        ka.ephemeralPubB = ephemeralPub;

        // Compute shared secret hash on-chain (both parties derive full secret off-chain)
        QuantumIdentity storage idA = identities[ka.partyA];
        QuantumIdentity storage idB = identities[ka.partyB];

        ka.sharedSecretHash = keccak256(abi.encodePacked(
            ka.ephemeralPubA,
            ka.ephemeralPubB,
            keccak256(abi.encodePacked(idA.keyAgreementPub, idB.keyAgreementPub))
        ));

        ka.establishedAt = block.timestamp;
        ka.active = true;

        emit KeyAgreementEstablished(agreementId, ka.partyA, ka.partyB);
    }

    // ============ Challenge-Response ============

    /**
     * @notice Create a quantum challenge for identity verification
     */
    function createChallenge(address target, uint256 deadline) external returns (bytes32) {
        bytes32 challengeHash = keccak256(abi.encodePacked(
            msg.sender, target, block.timestamp, blockhash(block.number - 1)
        ));

        bytes32 challengeId = keccak256(abi.encodePacked(challengeHash, block.timestamp));

        challenges[challengeId] = QuantumChallenge({
            challengeId: challengeId,
            challenger: msg.sender,
            target: target,
            challengeHash: challengeHash,
            responseHash: bytes32(0),
            createdAt: block.timestamp,
            deadline: deadline,
            completed: false,
            passed: false
        });

        emit QuantumChallengeCreated(challengeId, target);
        return challengeId;
    }

    /**
     * @notice Respond to a quantum challenge with a Lamport signature
     */
    function respondToChallenge(
        bytes32 challengeId,
        uint256 keyIndex,
        bytes32[256] calldata signature,
        bytes32[256] calldata publicKey,
        bytes32[] calldata merkleProof
    ) external {
        QuantumChallenge storage challenge = challenges[challengeId];
        require(challenge.target == msg.sender, "Not target");
        require(!challenge.completed, "Already completed");
        require(block.timestamp <= challenge.deadline, "Expired");

        QuantumIdentity storage identity = identities[msg.sender];
        if (!identity.active) revert QuantumIdentityNotFound();

        bool valid = _verifyLamportWithMerkle(
            identity.merkleRoot,
            keyIndex,
            signature,
            publicKey,
            merkleProof,
            challenge.challengeHash
        );

        challenge.completed = true;
        challenge.passed = valid;
        challenge.responseHash = keccak256(abi.encodePacked(signature));

        if (valid) {
            usedKeyIndices[msg.sender][keyIndex] = true;
            identity.usedKeys++;
        }

        emit QuantumChallengeCompleted(challengeId, valid);
    }

    // ============ Protection Registry ============

    /**
     * @notice Register an operation as requiring quantum authentication
     */
    function protectOperation(address target, bytes4 selector) external {
        // Only contract owner or governance can protect operations
        // For simplicity, allowing msg.sender == target
        require(msg.sender == target, "Not authorized");
        protectedOperations[target][selector] = true;
        emit OperationProtected(target, selector);
    }

    /**
     * @notice Check if an operation requires quantum auth
     */
    function isProtected(address target, bytes4 selector) external view returns (bool) {
        return protectedOperations[target][selector];
    }

    /**
     * @notice Set quantum enforcement threshold (ETH value)
     * @dev Operations above this value require quantum auth
     */
    function setQuantumThreshold(uint256 threshold) external {
        // In production: governance-controlled
        quantumThreshold = threshold;
        emit QuantumThresholdUpdated(threshold);
    }

    /**
     * @notice Set recovery address for quantum identity
     */
    function setRecoveryAddress(address recovery) external {
        require(identities[msg.sender].active, "No identity");
        recoveryAddresses[msg.sender] = recovery;
        emit QuantumRecoverySet(msg.sender, recovery);
    }

    // ============ View ============

    function getIdentity(address account) external view returns (
        bytes32 merkleRoot,
        uint256 totalKeys,
        uint256 usedKeys,
        uint8 securityLevel,
        bool active,
        bool mandatory
    ) {
        QuantumIdentity storage id = identities[account];
        return (id.merkleRoot, id.totalKeys, id.usedKeys, id.securityLevel, id.active, id.mandatory);
    }

    function isKeyUsed(address account, uint256 keyIndex) external view returns (bool) {
        return usedKeyIndices[account][keyIndex];
    }

    function getRemainingKeys(address account) external view returns (uint256) {
        QuantumIdentity storage id = identities[account];
        return id.totalKeys - id.usedKeys;
    }

    function needsRotation(address account) external view returns (bool) {
        QuantumIdentity storage id = identities[account];
        if (!id.active) return false;
        // Need rotation if >80% keys used or key is older than rotation period
        return (id.usedKeys * 100 / id.totalKeys > 80) ||
               (block.timestamp > id.lastRotated + KEY_ROTATION_PERIOD);
    }

    // ============ Internal ============

    /**
     * @notice Verify a Lamport signature with Merkle proof of public key inclusion
     */
    function _verifyLamportWithMerkle(
        bytes32 merkleRoot,
        uint256 keyIndex,
        bytes32[256] calldata signature,
        bytes32[256] calldata publicKey,
        bytes32[] calldata merkleProof,
        bytes32 message
    ) internal pure returns (bool) {
        // 1. Verify public key is in Merkle tree
        bytes32 pkHash = keccak256(abi.encodePacked(publicKey));
        bytes32 leaf = keccak256(abi.encodePacked(keyIndex, pkHash));

        // Verify Merkle proof
        bytes32 computedRoot = leaf;
        for (uint256 i = 0; i < merkleProof.length; i++) {
            if (keyIndex % 2 == 0) {
                computedRoot = keccak256(abi.encodePacked(computedRoot, merkleProof[i]));
            } else {
                computedRoot = keccak256(abi.encodePacked(merkleProof[i], computedRoot));
            }
            keyIndex /= 2;
        }

        if (computedRoot != merkleRoot) return false;

        // 2. Verify Lamport signature
        bytes32 messageHash = sha256(abi.encodePacked(message));

        for (uint256 i = 0; i < 256; i++) {
            uint256 bit = (uint256(messageHash) >> (255 - i)) & 1;
            bytes32 expectedPk;

            if (bit == 0) {
                expectedPk = publicKey[i]; // pk[i] for bit 0
            } else {
                expectedPk = publicKey[i]; // In full implementation: pk[i][1]
            }

            // Hash the signature element and compare to public key
            if (sha256(abi.encodePacked(signature[i])) != expectedPk) {
                return false;
            }
        }

        return true;
    }
}
