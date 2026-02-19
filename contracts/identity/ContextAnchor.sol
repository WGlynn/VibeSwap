// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./interfaces/IContextAnchor.sol";
import "./interfaces/IAgentRegistry.sol";

/**
 * @title ContextAnchor
 * @notice On-chain anchor for PsiNet context graphs — IPFS stored, Merkle verified.
 *
 * This is the bridge between PsiNet's off-chain context layer and VibeSwap's
 * on-chain identity/reputation system. Every context update is a contribution
 * that feeds into VibeCode reputation scores.
 *
 * Context graphs are AI conversation history stored as DAGs on IPFS.
 * This contract stores only Merkle roots — O(1) storage, O(log n) verification.
 *
 * CRDT-compatible: graphs from different agents can be merged without conflicts.
 */
contract ContextAnchor is IContextAnchor, OwnableUpgradeable, UUPSUpgradeable {

    // ============ Constants ============

    uint256 public constant MAX_ACCESS_GRANTS = 50;
    uint256 public constant MAX_MERGE_HISTORY = 100;

    // ============ State ============

    uint256 private _graphNonce;
    uint256 private _mergeNonce;

    // Graph storage
    mapping(bytes32 => ContextGraph) private _graphs;
    mapping(uint256 => bytes32[]) private _agentGraphs;     // agentId → graphIds
    mapping(address => bytes32[]) private _ownerGraphs;     // address → graphIds

    // Access control per graph
    mapping(bytes32 => mapping(address => AccessGrant)) private _accessGrants;
    mapping(bytes32 => address[]) private _accessGrantList;

    // Merge history
    mapping(bytes32 => MergeRecord[]) private _mergeHistory;

    // External
    IAgentRegistry public agentRegistry;

    // ============ Initializer ============

    function initialize(address _agentRegistry) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        agentRegistry = IAgentRegistry(_agentRegistry);
        _graphNonce = 1;
        _mergeNonce = 1;
    }

    // ============ Modifiers ============

    modifier onlyGraphOwner(bytes32 graphId) {
        ContextGraph storage g = _graphs[graphId];
        if (g.createdAt == 0) revert GraphNotFound();

        bool isOwner = false;
        if (g.ownerAgentId != 0) {
            // Agent-owned: check operator
            try agentRegistry.getAgent(g.ownerAgentId) returns (IAgentRegistry.AgentIdentity memory agent) {
                isOwner = (agent.operator == msg.sender);
            } catch {}
        }
        if (g.ownerAddress == msg.sender) isOwner = true;
        if (msg.sender == owner()) isOwner = true;

        if (!isOwner) revert NotGraphOwner();
        _;
    }

    // ============ Core Functions ============

    /// @inheritdoc IContextAnchor
    function createGraph(
        uint256 ownerAgentId,
        GraphType graphType,
        StorageBackend backend,
        bytes32 merkleRoot,
        bytes32 contentCID,
        uint256 nodeCount,
        uint256 edgeCount
    ) external returns (bytes32 graphId) {
        if (merkleRoot == bytes32(0)) revert ZeroRoot();
        if (contentCID == bytes32(0)) revert ZeroCID();

        // Verify agent exists if agent-owned
        address ownerAddr = msg.sender;
        if (ownerAgentId != 0) {
            IAgentRegistry.AgentIdentity memory agent = agentRegistry.getAgent(ownerAgentId);
            require(agent.operator == msg.sender, "Not agent operator");
            ownerAddr = agent.operator;
        }

        graphId = keccak256(abi.encodePacked(
            msg.sender,
            ownerAgentId,
            _graphNonce++,
            block.timestamp
        ));

        _graphs[graphId] = ContextGraph({
            graphId: graphId,
            ownerAgentId: ownerAgentId,
            ownerAddress: ownerAddr,
            graphType: graphType,
            backend: backend,
            merkleRoot: merkleRoot,
            contentCID: contentCID,
            nodeCount: nodeCount,
            edgeCount: edgeCount,
            createdAt: block.timestamp,
            lastUpdatedAt: block.timestamp,
            version: 1
        });

        if (ownerAgentId != 0) {
            _agentGraphs[ownerAgentId].push(graphId);
        }
        _ownerGraphs[ownerAddr].push(graphId);

        emit GraphCreated(graphId, ownerAgentId, ownerAddr, graphType);
    }

    /// @inheritdoc IContextAnchor
    function updateGraph(
        bytes32 graphId,
        bytes32 newMerkleRoot,
        bytes32 newContentCID,
        uint256 newNodeCount,
        uint256 newEdgeCount
    ) external onlyGraphOwner(graphId) {
        if (newMerkleRoot == bytes32(0)) revert ZeroRoot();

        ContextGraph storage g = _graphs[graphId];
        bytes32 oldRoot = g.merkleRoot;

        g.merkleRoot = newMerkleRoot;
        g.contentCID = newContentCID;
        g.nodeCount = newNodeCount;
        g.edgeCount = newEdgeCount;
        g.lastUpdatedAt = block.timestamp;
        g.version++;

        emit GraphUpdated(graphId, oldRoot, newMerkleRoot, g.version);
    }

    /// @inheritdoc IContextAnchor
    function mergeGraphs(
        bytes32 sourceGraphId,
        bytes32 targetGraphId,
        bytes32 resultRoot,
        bytes32 resultCID,
        uint256 nodesAdded,
        uint256 conflictsResolved
    ) external returns (bytes32 mergeId) {
        ContextGraph storage source = _graphs[sourceGraphId];
        ContextGraph storage target = _graphs[targetGraphId];

        if (source.createdAt == 0) revert GraphNotFound();
        if (target.createdAt == 0) revert GraphNotFound();

        // Must be graph owner of target OR have merge access
        bool canMerge = false;
        if (target.ownerAddress == msg.sender) canMerge = true;
        if (msg.sender == owner()) canMerge = true;

        // Check agent operator
        if (!canMerge && target.ownerAgentId != 0) {
            try agentRegistry.getAgent(target.ownerAgentId) returns (IAgentRegistry.AgentIdentity memory agent) {
                if (agent.operator == msg.sender) canMerge = true;
            } catch {}
        }

        // Check access grant
        if (!canMerge) {
            AccessGrant storage grant = _accessGrants[targetGraphId][msg.sender];
            if (grant.grantedAt != 0 && !grant.revoked && grant.canMerge) {
                if (grant.expiresAt == 0 || grant.expiresAt > block.timestamp) {
                    canMerge = true;
                }
            }
        }

        if (!canMerge) revert MergeNotAllowed();

        mergeId = keccak256(abi.encodePacked(
            sourceGraphId,
            targetGraphId,
            _mergeNonce++,
            block.timestamp
        ));

        // Update target graph with merged data
        target.merkleRoot = resultRoot;
        target.contentCID = resultCID;
        target.nodeCount += nodesAdded;
        target.lastUpdatedAt = block.timestamp;
        target.version++;

        // Record merge
        _mergeHistory[targetGraphId].push(MergeRecord({
            mergeId: mergeId,
            sourceGraphId: sourceGraphId,
            targetGraphId: targetGraphId,
            resultRoot: resultRoot,
            mergedBy: msg.sender,
            timestamp: block.timestamp,
            nodesAdded: nodesAdded,
            conflictsResolved: conflictsResolved
        }));

        emit GraphMerged(mergeId, sourceGraphId, targetGraphId, resultRoot);
    }

    /// @inheritdoc IContextAnchor
    function archiveGraph(bytes32 graphId, bytes32 arweaveTxId) external onlyGraphOwner(graphId) {
        ContextGraph storage g = _graphs[graphId];
        g.backend = StorageBackend.HYBRID;
        g.graphType = GraphType.ARCHIVE;

        emit GraphArchived(graphId, arweaveTxId);
    }

    // ============ Access Control ============

    /// @inheritdoc IContextAnchor
    function grantAccess(
        bytes32 graphId,
        address grantee,
        uint256 granteeAgentId,
        bool canMerge,
        uint256 expiresAt
    ) external onlyGraphOwner(graphId) {
        _accessGrants[graphId][grantee] = AccessGrant({
            grantee: grantee,
            granteeAgentId: granteeAgentId,
            grantedAt: block.timestamp,
            expiresAt: expiresAt,
            canMerge: canMerge,
            revoked: false
        });

        _accessGrantList[graphId].push(grantee);

        emit AccessGranted(graphId, grantee, granteeAgentId, canMerge);
    }

    /// @inheritdoc IContextAnchor
    function revokeAccess(bytes32 graphId, address grantee) external onlyGraphOwner(graphId) {
        _accessGrants[graphId][grantee].revoked = true;
        emit AccessRevoked(graphId, grantee);
    }

    // ============ Verification ============

    /// @inheritdoc IContextAnchor
    function verifyContextNode(
        bytes32 graphId,
        bytes32 nodeHash,
        bytes32[] calldata proof
    ) external view returns (bool) {
        ContextGraph storage g = _graphs[graphId];
        if (g.createdAt == 0) revert GraphNotFound();

        // Standard Merkle proof verification
        bytes32 computedHash = nodeHash;
        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        return computedHash == g.merkleRoot;
    }

    // ============ View Functions ============

    /// @inheritdoc IContextAnchor
    function getGraph(bytes32 graphId) external view returns (ContextGraph memory) {
        if (_graphs[graphId].createdAt == 0) revert GraphNotFound();
        return _graphs[graphId];
    }

    /// @inheritdoc IContextAnchor
    function getGraphsByAgent(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentGraphs[agentId];
    }

    /// @inheritdoc IContextAnchor
    function getGraphsByOwner(address ownerAddr) external view returns (bytes32[] memory) {
        return _ownerGraphs[ownerAddr];
    }

    /// @inheritdoc IContextAnchor
    function getMergeHistory(bytes32 graphId) external view returns (MergeRecord[] memory) {
        return _mergeHistory[graphId];
    }

    /// @inheritdoc IContextAnchor
    function hasAccess(bytes32 graphId, address user) external view returns (bool) {
        // Owner always has access
        ContextGraph storage g = _graphs[graphId];
        if (g.ownerAddress == user) return true;

        // Check agent operator
        if (g.ownerAgentId != 0) {
            try agentRegistry.getAgent(g.ownerAgentId) returns (IAgentRegistry.AgentIdentity memory agent) {
                if (agent.operator == user) return true;
            } catch {}
        }

        // Check access grant
        AccessGrant storage grant = _accessGrants[graphId][user];
        if (grant.grantedAt == 0 || grant.revoked) return false;
        if (grant.expiresAt != 0 && grant.expiresAt <= block.timestamp) return false;
        return true;
    }

    /// @inheritdoc IContextAnchor
    function getAccessGrants(bytes32 graphId) external view returns (AccessGrant[] memory) {
        address[] storage grantees = _accessGrantList[graphId];
        AccessGrant[] memory result = new AccessGrant[](grantees.length);
        for (uint256 i = 0; i < grantees.length; i++) {
            result[i] = _accessGrants[graphId][grantees[i]];
        }
        return result;
    }

    /// @inheritdoc IContextAnchor
    function totalGraphs() external view returns (uint256) {
        return _graphNonce - 1;
    }

    // ============ Admin ============

    function setAgentRegistry(address _agentRegistry) external onlyOwner {
        agentRegistry = IAgentRegistry(_agentRegistry);
    }

    // ============ Internal ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
