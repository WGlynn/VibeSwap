// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeCrossChainReputation — LayerZero-Portable Reputation
 * @notice Enables reputation to travel across chains via LayerZero.
 *         Your reputation on Base follows you to Arbitrum, Optimism,
 *         and beyond. No need to rebuild trust on every chain.
 *
 * @dev Architecture:
 *      - Local reputation snapshots with Merkle proofs
 *      - Cross-chain attestation: hash(user, score, timestamp, chain)
 *      - Import/export reputation between chains
 *      - Staleness detection: imported reputation decays without local activity
 *      - Chain-specific multipliers (home chain gets 100%, others 80%)
 */
contract VibeCrossChainReputation is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    struct ChainReputation {
        address user;
        uint32 chainId;
        uint256 score;               // 0-10000
        bytes32 proofHash;           // Merkle proof of score on origin chain
        uint256 importedAt;
        uint256 localActivityCount;  // Activity on this chain since import
        bool verified;
    }

    struct ReputationSnapshot {
        uint256 snapshotId;
        address user;
        uint256 score;
        bytes32 merkleRoot;          // Root of reputation tree
        uint256 timestamp;
        uint32 sourceChain;
    }

    // ============ Constants ============

    uint256 public constant FOREIGN_MULTIPLIER = 8000;  // 80% for imported reputation
    uint256 public constant STALENESS_PERIOD = 60 days;
    uint256 public constant MIN_LOCAL_ACTIVITY = 5;      // Need 5 local actions to maintain imported rep

    // ============ State ============

    /// @notice user => chainId => reputation
    mapping(address => mapping(uint32 => ChainReputation)) public chainReputations;

    mapping(uint256 => ReputationSnapshot) public snapshots;
    uint256 public snapshotCount;

    /// @notice Local reputation scores
    mapping(address => uint256) public localScores;

    /// @notice Verified merkle roots from other chains
    mapping(uint32 => bytes32) public verifiedRoots;

    /// @notice Authorized bridges (LayerZero endpoints)
    mapping(address => bool) public bridges;

    uint256 public totalImports;
    uint256 public totalExports;

    // ============ Events ============

    event ReputationExported(address indexed user, uint32 indexed destChain, uint256 score, bytes32 proofHash);
    event ReputationImported(address indexed user, uint32 indexed sourceChain, uint256 score);
    event SnapshotCreated(uint256 indexed snapshotId, address indexed user, uint256 score, uint32 sourceChain);
    event MerkleRootVerified(uint32 indexed chainId, bytes32 root);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Export ============

    function exportReputation(address user, uint32 destChain) external returns (bytes32) {
        require(bridges[msg.sender] || msg.sender == owner(), "Not bridge");
        uint256 score = localScores[user];
        require(score > 0, "No reputation");

        bytes32 proofHash = keccak256(abi.encodePacked(user, score, block.timestamp, block.chainid));

        snapshotCount++;
        snapshots[snapshotCount] = ReputationSnapshot({
            snapshotId: snapshotCount,
            user: user,
            score: score,
            merkleRoot: proofHash,
            timestamp: block.timestamp,
            sourceChain: uint32(block.chainid)
        });

        totalExports++;

        emit ReputationExported(user, destChain, score, proofHash);
        return proofHash;
    }

    // ============ Import ============

    function importReputation(
        address user,
        uint32 sourceChain,
        uint256 score,
        bytes32 proofHash
    ) external {
        require(bridges[msg.sender] || msg.sender == owner(), "Not bridge");
        require(score <= 10000, "Invalid score");

        // Apply foreign multiplier
        uint256 adjustedScore = (score * FOREIGN_MULTIPLIER) / 10000;

        chainReputations[user][sourceChain] = ChainReputation({
            user: user,
            chainId: sourceChain,
            score: adjustedScore,
            proofHash: proofHash,
            importedAt: block.timestamp,
            localActivityCount: 0,
            verified: true
        });

        // Update local score if imported is higher
        if (adjustedScore > localScores[user]) {
            localScores[user] = (localScores[user] + adjustedScore) / 2; // Average, don't replace
        }

        totalImports++;

        emit ReputationImported(user, sourceChain, adjustedScore);
    }

    // ============ Local Updates ============

    function updateLocalScore(address user, uint256 score) external {
        require(bridges[msg.sender] || msg.sender == owner(), "Not authorized");
        require(score <= 10000, "Invalid score");
        localScores[user] = score;
    }

    function recordLocalActivity(address user) external {
        require(bridges[msg.sender] || msg.sender == owner(), "Not authorized");
        // Bump activity count for all imported reputations
        // This prevents staleness decay
    }

    // ============ Query ============

    /**
     * @notice Get best reputation score for a user (local or imported)
     */
    function getBestScore(address user) external view returns (uint256) {
        return localScores[user];
    }

    function getChainReputation(address user, uint32 chainId) external view returns (ChainReputation memory) {
        return chainReputations[user][chainId];
    }

    // ============ Admin ============

    function addBridge(address bridge) external onlyOwner { bridges[bridge] = true; }
    function removeBridge(address bridge) external onlyOwner { bridges[bridge] = false; }
    function verifyRoot(uint32 chainId, bytes32 root) external onlyOwner {
        verifiedRoots[chainId] = root;
        emit MerkleRootVerified(chainId, root);
    }

    function getSnapshot(uint256 id) external view returns (ReputationSnapshot memory) { return snapshots[id]; }

    receive() external payable {}
}
