// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentPersistence — On-Chain Persistent Memory Protocol
 * @notice Absorbs claude-mem patterns into a decentralized persistent memory layer.
 *         AI agents maintain durable memory across sessions with on-chain anchoring,
 *         semantic indexing, and cross-agent memory sharing.
 *
 * @dev Architecture (claude-mem absorption):
 *      - Memory banks: named collections of key-value memories
 *      - Semantic tags for retrieval (replaces file-based memory)
 *      - Cross-session persistence via on-chain anchoring
 *      - Memory decay: unused memories lose weight over time
 *      - Memory sharing: agents can grant read access to other agents
 *      - Memory versioning: track evolution of knowledge over time
 *      - Importance scoring: auto-prioritize high-value memories
 */
contract VibeAgentPersistence is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum MemoryType { FACT, PREFERENCE, PROCEDURE, CONTEXT, CONVERSATION, INSIGHT, CORRECTION }

    struct Memory {
        uint256 memoryId;
        bytes32 agentId;
        bytes32 bankId;              // Memory bank (namespace)
        bytes32 contentHash;         // IPFS hash of memory content
        MemoryType memType;
        uint256 importance;          // 0-10000
        uint256 accessCount;
        uint256 createdAt;
        uint256 lastAccessedAt;
        uint256 version;
        bytes32[] tags;              // Semantic tags for retrieval
        bool active;
    }

    struct MemoryBank {
        bytes32 bankId;
        bytes32 agentId;
        string name;
        uint256 memoryCount;
        uint256 maxMemories;         // Capacity limit
        uint256 createdAt;
        bool isPublic;               // Can other agents read?
    }

    struct MemoryGrant {
        bytes32 fromAgent;
        bytes32 toAgent;
        bytes32 bankId;
        bool readOnly;
        uint256 grantedAt;
        uint256 expiresAt;           // 0 = permanent
    }

    // ============ Constants ============

    uint256 public constant DECAY_PERIOD = 30 days;
    uint256 public constant DECAY_RATE = 100;        // -1% importance per period
    uint256 public constant MAX_TAGS = 10;
    uint256 public constant DEFAULT_MAX_MEMORIES = 1000;

    // ============ State ============

    mapping(uint256 => Memory) public memories;
    uint256 public memoryCount;

    mapping(bytes32 => MemoryBank) public banks;
    uint256 public bankCount;

    /// @notice Agent's memory banks: agentId => bankId[]
    mapping(bytes32 => bytes32[]) public agentBanks;

    /// @notice Bank memories: bankId => memoryId[]
    mapping(bytes32 => uint256[]) public bankMemories;

    /// @notice Memory grants: grantId => MemoryGrant
    mapping(bytes32 => MemoryGrant) public grants;

    /// @notice Tag index: tag => memoryId[] (for semantic retrieval)
    mapping(bytes32 => uint256[]) public tagIndex;

    /// @notice Stats
    uint256 public totalMemoriesStored;
    uint256 public totalMemoryAccesses;
    uint256 public totalBanksCreated;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event MemoryStored(uint256 indexed memoryId, bytes32 indexed agentId, bytes32 bankId, MemoryType memType, uint256 importance);
    event MemoryAccessed(uint256 indexed memoryId, bytes32 indexed agentId);
    event MemoryUpdated(uint256 indexed memoryId, uint256 newVersion, bytes32 newContentHash);
    event MemoryDecayed(uint256 indexed memoryId, uint256 newImportance);
    event BankCreated(bytes32 indexed bankId, bytes32 indexed agentId, string name);
    event MemoryGranted(bytes32 indexed fromAgent, bytes32 indexed toAgent, bytes32 bankId);
    event MemoryRevoked(bytes32 indexed fromAgent, bytes32 indexed toAgent, bytes32 bankId);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Memory Banks ============

    function createBank(
        bytes32 agentId,
        string calldata name,
        uint256 maxMemories,
        bool isPublic
    ) external returns (bytes32) {
        bytes32 bankId = keccak256(abi.encodePacked(agentId, name, block.timestamp));

        banks[bankId] = MemoryBank({
            bankId: bankId,
            agentId: agentId,
            name: name,
            memoryCount: 0,
            maxMemories: maxMemories > 0 ? maxMemories : DEFAULT_MAX_MEMORIES,
            createdAt: block.timestamp,
            isPublic: isPublic
        });

        agentBanks[agentId].push(bankId);
        totalBanksCreated++;

        emit BankCreated(bankId, agentId, name);
        return bankId;
    }

    // ============ Memory Storage ============

    function storeMemory(
        bytes32 agentId,
        bytes32 bankId,
        bytes32 contentHash,
        MemoryType memType,
        uint256 importance,
        bytes32[] calldata tags
    ) external returns (uint256) {
        MemoryBank storage bank = banks[bankId];
        require(bank.agentId == agentId, "Not bank owner");
        require(bank.memoryCount < bank.maxMemories, "Bank full");
        require(tags.length <= MAX_TAGS, "Too many tags");
        require(importance <= 10000, "Invalid importance");

        memoryCount++;

        memories[memoryCount] = Memory({
            memoryId: memoryCount,
            agentId: agentId,
            bankId: bankId,
            contentHash: contentHash,
            memType: memType,
            importance: importance,
            accessCount: 0,
            createdAt: block.timestamp,
            lastAccessedAt: block.timestamp,
            version: 1,
            tags: tags,
            active: true
        });

        bankMemories[bankId].push(memoryCount);
        bank.memoryCount++;
        totalMemoriesStored++;

        // Index by tags
        for (uint256 i = 0; i < tags.length; i++) {
            tagIndex[tags[i]].push(memoryCount);
        }

        emit MemoryStored(memoryCount, agentId, bankId, memType, importance);
        return memoryCount;
    }

    function updateMemory(
        uint256 memoryId,
        bytes32 newContentHash,
        uint256 newImportance
    ) external {
        Memory storage mem = memories[memoryId];
        require(mem.active, "Inactive");

        mem.contentHash = newContentHash;
        mem.importance = newImportance;
        mem.version++;
        mem.lastAccessedAt = block.timestamp;

        emit MemoryUpdated(memoryId, mem.version, newContentHash);
    }

    function accessMemory(uint256 memoryId, bytes32 accessingAgent) external {
        Memory storage mem = memories[memoryId];
        require(mem.active, "Inactive");

        // Check access permission
        if (mem.agentId != accessingAgent) {
            MemoryBank storage bank = banks[mem.bankId];
            if (!bank.isPublic) {
                bytes32 grantId = keccak256(abi.encodePacked(mem.agentId, accessingAgent, mem.bankId));
                require(grants[grantId].toAgent == accessingAgent, "No access");
                if (grants[grantId].expiresAt > 0) {
                    require(block.timestamp <= grants[grantId].expiresAt, "Grant expired");
                }
            }
        }

        mem.accessCount++;
        mem.lastAccessedAt = block.timestamp;
        totalMemoryAccesses++;

        // Boost importance on access (reinforcement)
        if (mem.importance < 10000) {
            mem.importance += 50;
            if (mem.importance > 10000) mem.importance = 10000;
        }

        emit MemoryAccessed(memoryId, accessingAgent);
    }

    function deleteMemory(uint256 memoryId) external {
        Memory storage mem = memories[memoryId];
        require(mem.active, "Already inactive");
        mem.active = false;
    }

    // ============ Memory Decay ============

    /**
     * @notice Apply decay to unused memories (keeper function)
     */
    function applyDecay(uint256[] calldata memoryIds) external {
        for (uint256 i = 0; i < memoryIds.length; i++) {
            Memory storage mem = memories[memoryIds[i]];
            if (!mem.active) continue;

            uint256 elapsed = block.timestamp - mem.lastAccessedAt;
            if (elapsed < DECAY_PERIOD) continue;

            uint256 periods = elapsed / DECAY_PERIOD;
            uint256 decay = periods * DECAY_RATE;

            if (decay >= mem.importance) {
                mem.importance = 0;
            } else {
                mem.importance -= decay;
            }

            emit MemoryDecayed(memoryIds[i], mem.importance);
        }
    }

    // ============ Memory Sharing ============

    function grantAccess(
        bytes32 fromAgent,
        bytes32 toAgent,
        bytes32 bankId,
        bool readOnly,
        uint256 durationSeconds
    ) external {
        require(banks[bankId].agentId == fromAgent, "Not bank owner");

        bytes32 grantId = keccak256(abi.encodePacked(fromAgent, toAgent, bankId));
        grants[grantId] = MemoryGrant({
            fromAgent: fromAgent,
            toAgent: toAgent,
            bankId: bankId,
            readOnly: readOnly,
            grantedAt: block.timestamp,
            expiresAt: durationSeconds > 0 ? block.timestamp + durationSeconds : 0
        });

        emit MemoryGranted(fromAgent, toAgent, bankId);
    }

    function revokeAccess(bytes32 fromAgent, bytes32 toAgent, bytes32 bankId) external {
        require(banks[bankId].agentId == fromAgent, "Not bank owner");
        bytes32 grantId = keccak256(abi.encodePacked(fromAgent, toAgent, bankId));
        delete grants[grantId];
        emit MemoryRevoked(fromAgent, toAgent, bankId);
    }

    // ============ View ============

    function getMemory(uint256 id) external view returns (Memory memory) { return memories[id]; }
    function getBank(bytes32 id) external view returns (MemoryBank memory) { return banks[id]; }
    function getBankMemories(bytes32 bankId) external view returns (uint256[] memory) { return bankMemories[bankId]; }
    function getAgentBanks(bytes32 agentId) external view returns (bytes32[] memory) { return agentBanks[agentId]; }
    function getByTag(bytes32 tag) external view returns (uint256[] memory) { return tagIndex[tag]; }
    function getMemoryTags(uint256 memoryId) external view returns (bytes32[] memory) { return memories[memoryId].tags; }

    receive() external payable {}
}
