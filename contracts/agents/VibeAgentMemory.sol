// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentMemory
 * @notice VSOS Agent Memory Layer — persistent, verifiable memory for AI agents.
 *
 * Agents store episodic, semantic, procedural, and contextual memories on-chain
 * (content hashes pointing to IPFS). Memories can be linked into graphs, shared
 * across agents, verified by validators, and pruned when expired.
 *
 * "Memory is proof that a Mind existed."
 */
contract VibeAgentMemory is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {

    // ============ Enums ============

    enum MemoryType { EPISODIC, SEMANTIC, PROCEDURAL, CONTEXTUAL }
    enum AccessPolicy { PUBLIC, PRIVATE, PERMISSIONED }
    enum RelationType { RELATED, CONTRADICTING, EXTENDING }

    // ============ Structs ============

    struct MemoryEntry {
        bytes32 entryId;
        bytes32 agentId;
        MemoryType memoryType;
        bytes32 contentHash;
        uint16 importance;       // 0-10000
        uint256 timestamp;
        uint256 expiresAt;       // 0 = permanent
        bool verified;
        bool active;
    }

    struct MemoryIndex {
        bytes32 agentId;
        uint256 totalEntries;
        uint256 totalVerified;
        uint256 lastUpdated;
    }

    struct SharedMemory {
        bytes32 memoryId;
        string name;
        address[] contributors;
        bytes32[] entryIds;
        AccessPolicy accessPolicy;
        uint256 createdAt;
    }

    struct MemoryLink {
        bytes32 fromId;
        bytes32 toId;
        RelationType relationType;
        uint256 timestamp;
    }

    // ============ State ============

    mapping(bytes32 => MemoryEntry) public memories;
    mapping(bytes32 => MemoryIndex) public indices;
    mapping(bytes32 => SharedMemory) internal _sharedMemories;
    mapping(bytes32 => MemoryLink[]) public memoryLinks;

    /// @dev agentId => list of entryIds for enumeration
    mapping(bytes32 => bytes32[]) internal _agentEntries;

    /// @dev entryId => owner address (who stored it)
    mapping(bytes32 => address) public memoryOwner;

    /// @dev sharedMemoryId => address => bool (contributor whitelist)
    mapping(bytes32 => mapping(address => bool)) public isContributor;

    /// @dev address => bool
    mapping(address => bool) public validators;

    uint256 public totalMemories;
    uint256 public totalShared;
    uint256 private _nonce;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event MemoryStored(bytes32 indexed entryId, bytes32 indexed agentId, MemoryType memoryType, uint16 importance);
    event MemoryVerified(bytes32 indexed entryId, address indexed validator);
    event MemoryPruned(bytes32 indexed entryId);
    event SharedMemoryCreated(bytes32 indexed memoryId, string name, AccessPolicy accessPolicy);
    event ContributedToShared(bytes32 indexed memoryId, bytes32 indexed entryId);
    event MemoriesLinked(bytes32 indexed fromId, bytes32 indexed toId, RelationType relationType);
    event ValidatorSet(address indexed validator, bool status);

    // ============ Errors ============

    error InvalidImportance();
    error MemoryNotFound();
    error NotMemoryOwner();
    error NotValidator();
    error AccessDenied();
    error AlreadyVerified();
    error NotExpired();
    error SharedMemoryNotFound();
    error NotContributor();
    error MemoryInactive();

    // ============ Initializer ============

    function initialize(address _owner) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    // ============ Admin ============

    function setValidator(address _validator, bool _status) external onlyOwner {
        validators[_validator] = _status;
        emit ValidatorSet(_validator, _status);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Store Memory ============

    function storeMemory(
        bytes32 agentId,
        MemoryType memoryType,
        bytes32 contentHash,
        uint16 importance,
        uint256 expiresAt
    ) external nonReentrant returns (bytes32 entryId) {
        if (importance > 10000) revert InvalidImportance();

        _nonce++;
        entryId = keccak256(abi.encodePacked(agentId, contentHash, block.timestamp, _nonce));

        memories[entryId] = MemoryEntry({
            entryId: entryId,
            agentId: agentId,
            memoryType: memoryType,
            contentHash: contentHash,
            importance: importance,
            timestamp: block.timestamp,
            expiresAt: expiresAt,
            verified: false,
            active: true
        });

        memoryOwner[entryId] = msg.sender;
        _agentEntries[agentId].push(entryId);
        totalMemories++;

        MemoryIndex storage idx = indices[agentId];
        if (idx.agentId == bytes32(0)) idx.agentId = agentId;
        idx.totalEntries++;
        idx.lastUpdated = block.timestamp;

        emit MemoryStored(entryId, agentId, memoryType, importance);
    }

    // ============ Recall Memory ============

    function recallMemory(bytes32 entryId) external view returns (MemoryEntry memory) {
        MemoryEntry storage entry = memories[entryId];
        if (entry.entryId == bytes32(0)) revert MemoryNotFound();
        if (!entry.active) revert MemoryInactive();
        return entry;
    }

    // ============ Verify Memory ============

    function verifyMemory(bytes32 entryId) external {
        if (!validators[msg.sender]) revert NotValidator();
        MemoryEntry storage entry = memories[entryId];
        if (entry.entryId == bytes32(0)) revert MemoryNotFound();
        if (entry.verified) revert AlreadyVerified();

        entry.verified = true;
        indices[entry.agentId].totalVerified++;

        emit MemoryVerified(entryId, msg.sender);
    }

    // ============ Shared Memory ============

    function createSharedMemory(
        string calldata name,
        address[] calldata contributors,
        AccessPolicy accessPolicy
    ) external nonReentrant returns (bytes32 memoryId) {
        _nonce++;
        memoryId = keccak256(abi.encodePacked(name, msg.sender, block.timestamp, _nonce));

        SharedMemory storage sm = _sharedMemories[memoryId];
        sm.memoryId = memoryId;
        sm.name = name;
        sm.accessPolicy = accessPolicy;
        sm.createdAt = block.timestamp;

        for (uint256 i; i < contributors.length; i++) {
            sm.contributors.push(contributors[i]);
            isContributor[memoryId][contributors[i]] = true;
        }
        // Creator is always a contributor
        if (!isContributor[memoryId][msg.sender]) {
            sm.contributors.push(msg.sender);
            isContributor[memoryId][msg.sender] = true;
        }

        totalShared++;
        emit SharedMemoryCreated(memoryId, name, accessPolicy);
    }

    function contributeToShared(bytes32 memoryId, bytes32 entryId) external {
        SharedMemory storage sm = _sharedMemories[memoryId];
        if (sm.memoryId == bytes32(0)) revert SharedMemoryNotFound();
        if (sm.accessPolicy == AccessPolicy.PERMISSIONED && !isContributor[memoryId][msg.sender]) {
            revert NotContributor();
        }
        MemoryEntry storage entry = memories[entryId];
        if (entry.entryId == bytes32(0)) revert MemoryNotFound();
        if (memoryOwner[entryId] != msg.sender) revert NotMemoryOwner();

        sm.entryIds.push(entryId);
        emit ContributedToShared(memoryId, entryId);
    }

    function getSharedMemory(bytes32 memoryId) external view returns (
        bytes32, string memory, address[] memory, bytes32[] memory, AccessPolicy, uint256
    ) {
        SharedMemory storage sm = _sharedMemories[memoryId];
        if (sm.memoryId == bytes32(0)) revert SharedMemoryNotFound();
        if (sm.accessPolicy == AccessPolicy.PRIVATE && !isContributor[memoryId][msg.sender]) {
            revert AccessDenied();
        }
        return (sm.memoryId, sm.name, sm.contributors, sm.entryIds, sm.accessPolicy, sm.createdAt);
    }

    // ============ Memory Graph ============

    function linkMemories(bytes32 fromId, bytes32 toId, RelationType relationType) external {
        if (memories[fromId].entryId == bytes32(0)) revert MemoryNotFound();
        if (memories[toId].entryId == bytes32(0)) revert MemoryNotFound();
        if (memoryOwner[fromId] != msg.sender) revert NotMemoryOwner();

        MemoryLink memory link = MemoryLink({
            fromId: fromId,
            toId: toId,
            relationType: relationType,
            timestamp: block.timestamp
        });

        memoryLinks[fromId].push(link);
        emit MemoriesLinked(fromId, toId, relationType);
    }

    function getLinks(bytes32 entryId) external view returns (MemoryLink[] memory) {
        return memoryLinks[entryId];
    }

    // ============ Prune Expired ============

    function pruneExpired(bytes32[] calldata entryIds) external nonReentrant {
        for (uint256 i; i < entryIds.length; i++) {
            MemoryEntry storage entry = memories[entryIds[i]];
            if (entry.entryId == bytes32(0)) continue;
            if (entry.expiresAt == 0 || block.timestamp < entry.expiresAt) revert NotExpired();

            entry.active = false;
            emit MemoryPruned(entryIds[i]);
        }
    }

    // ============ Views ============

    function getAgentEntries(bytes32 agentId) external view returns (bytes32[] memory) {
        return _agentEntries[agentId];
    }

    function getMemoryIndex(bytes32 agentId) external view returns (MemoryIndex memory) {
        return indices[agentId];
    }
}
