// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IContextAnchor
 * @notice On-chain anchor for PsiNet context graphs — IPFS/Arweave stored, Merkle verified.
 *
 * Context graphs represent AI conversation history and knowledge:
 * - Nodes = messages, insights, decisions
 * - Edges = relationships (reply-to, references, contradicts, builds-on)
 * - Stored off-chain (IPFS), anchored on-chain via Merkle roots
 *
 * Integration with VibeSwap:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  AgentRegistry       → Agent owns context graphs               │
 * │  ContributionDAG     → Context updates record as contributions  │
 * │  VibeCode            → Context depth feeds community score      │
 * │  Forum               → Forum posts can reference context nodes  │
 * │  RewardLedger        → Valuable context = value events          │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * CRDT-compatible: Multiple agents can merge context graphs without
 * conflicts via Merkle root comparison and CRDT merge semantics.
 */
interface IContextAnchor {

    // ============ Enums ============

    /// @notice Type of context graph
    enum GraphType {
        CONVERSATION,   // Chat/dialogue history
        KNOWLEDGE,      // Accumulated knowledge base
        DECISION,       // Decision audit trail
        COLLABORATION,  // Multi-agent shared context
        ARCHIVE         // Permanently stored context
    }

    /// @notice Storage backend
    enum StorageBackend {
        IPFS,           // Content-addressed, pinned
        ARWEAVE,        // Permanent storage
        HYBRID          // IPFS + Arweave backup
    }

    // ============ Structs ============

    /// @notice A context graph anchored on-chain
    struct ContextGraph {
        bytes32 graphId;
        uint256 ownerAgentId;           // AgentRegistry agent ID (0 = human-owned)
        address ownerAddress;           // Fallback for human-owned graphs
        GraphType graphType;
        StorageBackend backend;
        bytes32 merkleRoot;             // Merkle root of all context nodes
        bytes32 contentCID;             // IPFS CID of full graph data
        uint256 nodeCount;              // Number of nodes in graph
        uint256 edgeCount;              // Number of edges in graph
        uint256 createdAt;
        uint256 lastUpdatedAt;
        uint256 version;                // Incremented on each update
    }

    /// @notice A merge operation between two context graphs
    struct MergeRecord {
        bytes32 mergeId;
        bytes32 sourceGraphId;
        bytes32 targetGraphId;
        bytes32 resultRoot;             // New Merkle root after merge
        address mergedBy;
        uint256 timestamp;
        uint256 nodesAdded;
        uint256 conflictsResolved;
    }

    /// @notice Access permission for shared context
    struct AccessGrant {
        address grantee;                // Who can read
        uint256 granteeAgentId;         // 0 if human
        uint256 grantedAt;
        uint256 expiresAt;              // 0 = permanent
        bool canMerge;                  // Can merge into this graph
        bool revoked;
    }

    // ============ Events ============

    event GraphCreated(bytes32 indexed graphId, uint256 indexed ownerAgentId, address indexed ownerAddress, GraphType graphType);
    event GraphUpdated(bytes32 indexed graphId, bytes32 oldRoot, bytes32 newRoot, uint256 version);
    event GraphMerged(bytes32 indexed mergeId, bytes32 indexed sourceGraphId, bytes32 indexed targetGraphId, bytes32 resultRoot);
    event AccessGranted(bytes32 indexed graphId, address indexed grantee, uint256 granteeAgentId, bool canMerge);
    event AccessRevoked(bytes32 indexed graphId, address indexed grantee);
    event GraphArchived(bytes32 indexed graphId, bytes32 arweaveTxId);
    event ContextContributionRecorded(bytes32 indexed graphId, address indexed contributor, uint256 nodeCount);

    // ============ Errors ============

    error GraphNotFound();
    error NotGraphOwner();
    error GraphAlreadyExists();
    error AccessDenied();
    error MergeNotAllowed();
    error InvalidMerkleProof();
    error ZeroRoot();
    error ZeroCID();
    error GraphIsArchived();

    // ============ Core Functions ============

    /// @notice Create a new context graph
    function createGraph(
        uint256 ownerAgentId,
        GraphType graphType,
        StorageBackend backend,
        bytes32 merkleRoot,
        bytes32 contentCID,
        uint256 nodeCount,
        uint256 edgeCount
    ) external returns (bytes32 graphId);

    /// @notice Update an existing context graph (new version)
    function updateGraph(
        bytes32 graphId,
        bytes32 newMerkleRoot,
        bytes32 newContentCID,
        uint256 newNodeCount,
        uint256 newEdgeCount
    ) external;

    /// @notice Merge two context graphs (CRDT semantics)
    function mergeGraphs(
        bytes32 sourceGraphId,
        bytes32 targetGraphId,
        bytes32 resultRoot,
        bytes32 resultCID,
        uint256 nodesAdded,
        uint256 conflictsResolved
    ) external returns (bytes32 mergeId);

    /// @notice Archive a graph to permanent storage (Arweave)
    function archiveGraph(bytes32 graphId, bytes32 arweaveTxId) external;

    // ============ Access Control ============

    /// @notice Grant read (and optionally merge) access to another entity
    function grantAccess(bytes32 graphId, address grantee, uint256 granteeAgentId, bool canMerge, uint256 expiresAt) external;

    /// @notice Revoke access
    function revokeAccess(bytes32 graphId, address grantee) external;

    // ============ Verification ============

    /// @notice Verify a context node exists in a graph via Merkle proof
    function verifyContextNode(
        bytes32 graphId,
        bytes32 nodeHash,
        bytes32[] calldata proof
    ) external view returns (bool);

    // ============ View Functions ============

    function getGraph(bytes32 graphId) external view returns (ContextGraph memory);
    function getGraphsByAgent(uint256 agentId) external view returns (bytes32[] memory);
    function getGraphsByOwner(address owner) external view returns (bytes32[] memory);
    function getMergeHistory(bytes32 graphId) external view returns (MergeRecord[] memory);
    function hasAccess(bytes32 graphId, address user) external view returns (bool);
    function getAccessGrants(bytes32 graphId) external view returns (AccessGrant[] memory);
    function totalGraphs() external view returns (uint256);
}
