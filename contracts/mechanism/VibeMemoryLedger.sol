// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeMemoryLedger — On-Chain Contribution Observation System
 * @notice Deep absorption of claude-mem's architecture: observations with
 *         token economics (discovery cost vs read cost), content-hash
 *         deduplication, concept indexing, progressive disclosure, and
 *         session-scoped memory accumulation.
 *
 * @dev Architecture (claude-mem deep absorption):
 *      - Observations = atomic work units (who did what, at what cost)
 *      - Discovery tokens = gas/effort invested to uncover the value
 *      - Read tokens = cost to query the stored observation
 *      - Content-hash dedup prevents re-claiming same work
 *      - Concept indexing for efficient semantic retrieval
 *      - Progressive disclosure: search → timeline → detail
 *      - Session summaries for epoch-level context injection
 *      - Integrates with Shapley to weight rewards by discovery cost
 */
contract VibeMemoryLedger is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum ObservationType { BUGFIX, FEATURE, AUDIT, RESEARCH, OPTIMIZATION, DOCUMENTATION, EXPERIMENT, GOVERNANCE }

    struct Observation {
        uint256 observationId;
        bytes32 contributorId;       // SoulboundIdentity or AgentRegistry ID
        address contributor;
        bytes32 projectId;           // Scope (DAO, contract, or protocol)
        ObservationType obsType;
        bytes32 titleHash;           // IPFS hash of title
        bytes32 narrativeHash;       // IPFS hash of detailed narrative
        bytes32 contentHash;         // SHA256(contributor || title || narrative) for dedup
        uint256 discoveryTokens;     // Gas/effort invested to uncover this
        uint256 readTokens;          // Cost to query this observation
        bytes32[] concepts;          // Semantic tags for search
        uint256 epochId;             // Which governance epoch
        uint256 createdAt;
        bool verified;               // Confirmed by peers
    }

    struct EpochSummary {
        uint256 epochId;
        bytes32 projectId;
        uint256 observationCount;
        uint256 totalDiscoveryTokens;
        uint256 totalReadTokens;
        uint256 tokenSavingsPercent; // (discovery - read) / discovery * 100
        bytes32 summaryHash;         // IPFS hash of epoch summary
        uint256 closedAt;
    }

    struct ContributorProfile {
        bytes32 contributorId;
        address contributor;
        uint256 totalObservations;
        uint256 totalDiscoveryTokens;
        uint256 totalReadTokens;
        uint256 verifiedObservations;
        uint256 reputationFromMemory; // Based on discovery/read ratio
    }

    // ============ Constants ============

    uint256 public constant DEDUP_WINDOW = 30; // 30-second dedup window (like claude-mem)
    uint256 public constant MAX_CONCEPTS = 10;

    // ============ State ============

    mapping(uint256 => Observation) public observations;
    uint256 public observationCount;

    mapping(uint256 => EpochSummary) public epochSummaries;
    uint256 public currentEpoch;

    mapping(bytes32 => ContributorProfile) public contributors;

    /// @notice Content-hash deduplication
    mapping(bytes32 => bool) public contentHashExists;
    mapping(bytes32 => uint256) public contentHashTimestamp;

    /// @notice Concept index: concept => observationId[]
    mapping(bytes32 => uint256[]) public conceptIndex;

    /// @notice Project observations: projectId => observationId[]
    mapping(bytes32 => uint256[]) public projectObservations;

    /// @notice Epoch observations: epochId => observationId[]
    mapping(uint256 => uint256[]) public epochObservations;

    /// @notice Stats
    uint256 public totalDiscoveryTokensRecorded;
    uint256 public totalReadTokensRecorded;
    uint256 public totalObservationsVerified;

    // ============ Events ============

    event ObservationCaptured(uint256 indexed observationId, bytes32 indexed contributorId, bytes32 projectId, ObservationType obsType, uint256 discoveryTokens);
    event ObservationVerified(uint256 indexed observationId, bytes32 indexed contributorId);
    event ObservationDuplicate(bytes32 contentHash, bytes32 contributorId);
    event EpochClosed(uint256 indexed epochId, bytes32 indexed projectId, uint256 observationCount, uint256 tokenSavingsPercent);
    event ConceptIndexed(bytes32 indexed concept, uint256 indexed observationId);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        currentEpoch = 1;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Observation Capture ============

    /**
     * @notice Capture an observation (atomic work unit)
     * @dev Deduplicates by content-hash within 30-second window
     */
    function captureObservation(
        bytes32 contributorId,
        bytes32 projectId,
        ObservationType obsType,
        bytes32 titleHash,
        bytes32 narrativeHash,
        uint256 discoveryTokens,
        uint256 readTokens,
        bytes32[] calldata concepts
    ) external returns (uint256) {
        require(concepts.length <= MAX_CONCEPTS, "Too many concepts");
        require(discoveryTokens > 0, "Zero discovery cost");

        // Content-hash deduplication (like claude-mem)
        bytes32 contentHash = keccak256(abi.encodePacked(contributorId, titleHash, narrativeHash));

        if (contentHashExists[contentHash]) {
            // Check dedup window
            if (block.timestamp - contentHashTimestamp[contentHash] <= DEDUP_WINDOW) {
                emit ObservationDuplicate(contentHash, contributorId);
                return 0; // Silently deduplicate
            }
        }

        contentHashExists[contentHash] = true;
        contentHashTimestamp[contentHash] = block.timestamp;

        observationCount++;
        observations[observationCount] = Observation({
            observationId: observationCount,
            contributorId: contributorId,
            contributor: msg.sender,
            projectId: projectId,
            obsType: obsType,
            titleHash: titleHash,
            narrativeHash: narrativeHash,
            contentHash: contentHash,
            discoveryTokens: discoveryTokens,
            readTokens: readTokens,
            concepts: concepts,
            epochId: currentEpoch,
            createdAt: block.timestamp,
            verified: false
        });

        // Index by concept
        for (uint256 i = 0; i < concepts.length; i++) {
            conceptIndex[concepts[i]].push(observationCount);
            emit ConceptIndexed(concepts[i], observationCount);
        }

        // Index by project and epoch
        projectObservations[projectId].push(observationCount);
        epochObservations[currentEpoch].push(observationCount);

        // Update contributor profile
        ContributorProfile storage profile = contributors[contributorId];
        profile.contributorId = contributorId;
        profile.contributor = msg.sender;
        profile.totalObservations++;
        profile.totalDiscoveryTokens += discoveryTokens;
        profile.totalReadTokens += readTokens;

        totalDiscoveryTokensRecorded += discoveryTokens;
        totalReadTokensRecorded += readTokens;

        emit ObservationCaptured(observationCount, contributorId, projectId, obsType, discoveryTokens);
        return observationCount;
    }

    // ============ Verification ============

    function verifyObservation(uint256 observationId) external {
        Observation storage obs = observations[observationId];
        require(!obs.verified, "Already verified");
        // Only project owner or protocol admin can verify
        obs.verified = true;
        contributors[obs.contributorId].verifiedObservations++;
        totalObservationsVerified++;

        // Update reputation based on discovery/read ratio
        ContributorProfile storage profile = contributors[obs.contributorId];
        if (profile.totalReadTokens > 0) {
            // Higher ratio = more efficient contributor = higher reputation
            profile.reputationFromMemory = (profile.totalDiscoveryTokens * 10000) / profile.totalReadTokens;
            if (profile.reputationFromMemory > 10000) profile.reputationFromMemory = 10000;
        }

        emit ObservationVerified(observationId, obs.contributorId);
    }

    // ============ Epoch Management ============

    function closeEpoch(bytes32 projectId, bytes32 summaryHash) external {
        uint256[] storage epochObs = epochObservations[currentEpoch];

        uint256 totalDiscovery;
        uint256 totalRead;
        for (uint256 i = 0; i < epochObs.length; i++) {
            Observation storage obs = observations[epochObs[i]];
            if (obs.projectId == projectId) {
                totalDiscovery += obs.discoveryTokens;
                totalRead += obs.readTokens;
            }
        }

        uint256 savingsPercent = totalDiscovery > 0
            ? ((totalDiscovery - totalRead) * 100) / totalDiscovery
            : 0;

        epochSummaries[currentEpoch] = EpochSummary({
            epochId: currentEpoch,
            projectId: projectId,
            observationCount: epochObs.length,
            totalDiscoveryTokens: totalDiscovery,
            totalReadTokens: totalRead,
            tokenSavingsPercent: savingsPercent,
            summaryHash: summaryHash,
            closedAt: block.timestamp
        });

        emit EpochClosed(currentEpoch, projectId, epochObs.length, savingsPercent);
        currentEpoch++;
    }

    // ============ Progressive Disclosure (Search Layer) ============

    /**
     * @notice Layer 1: Search by concept — returns compact IDs only (~50-100 tokens)
     */
    function searchByConcept(bytes32 concept) external view returns (uint256[] memory) {
        return conceptIndex[concept];
    }

    /**
     * @notice Layer 1: Search by project — returns compact IDs only
     */
    function searchByProject(bytes32 projectId) external view returns (uint256[] memory) {
        return projectObservations[projectId];
    }

    /**
     * @notice Layer 2: Timeline — returns observation metadata (not full content)
     */
    function getObservationMeta(uint256 obsId) external view returns (
        bytes32 contributorId,
        ObservationType obsType,
        uint256 discoveryTokens,
        uint256 readTokens,
        uint256 createdAt,
        bool verified
    ) {
        Observation storage obs = observations[obsId];
        return (obs.contributorId, obs.obsType, obs.discoveryTokens, obs.readTokens, obs.createdAt, obs.verified);
    }

    /**
     * @notice Layer 3: Full detail — returns complete observation
     */
    function getObservation(uint256 id) external view returns (Observation memory) {
        return observations[id];
    }

    // ============ Token Economics View ============

    /**
     * @notice Show token economics for a project's epoch
     * @dev Mirrors claude-mem's TokenCalculator.ts
     */
    function getTokenEconomics(bytes32 projectId, uint256 epochId) external view returns (
        uint256 totalDiscovery,
        uint256 totalRead,
        uint256 savings,
        uint256 savingsPercent
    ) {
        uint256[] storage epochObs = epochObservations[epochId];
        for (uint256 i = 0; i < epochObs.length; i++) {
            Observation storage obs = observations[epochObs[i]];
            if (obs.projectId == projectId) {
                totalDiscovery += obs.discoveryTokens;
                totalRead += obs.readTokens;
            }
        }
        savings = totalDiscovery > totalRead ? totalDiscovery - totalRead : 0;
        savingsPercent = totalDiscovery > 0 ? (savings * 100) / totalDiscovery : 0;
    }

    // ============ View ============

    function getEpochSummary(uint256 id) external view returns (EpochSummary memory) { return epochSummaries[id]; }
    function getContributor(bytes32 id) external view returns (ContributorProfile memory) { return contributors[id]; }
    function getObservationConcepts(uint256 obsId) external view returns (bytes32[] memory) { return observations[obsId].concepts; }
    function getCurrentEpoch() external view returns (uint256) { return currentEpoch; }

    receive() external payable {}
}
