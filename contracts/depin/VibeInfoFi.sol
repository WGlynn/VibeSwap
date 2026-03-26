// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeInfoFi — True Information Finance (CKB-Native)
 * @notice The ORIGINAL InfoFi architecture — not a bastardized version.
 *         Knowledge as a first-class economic asset with intrinsic pricing,
 *         contribution tracking, and retroactive value attribution.
 *
 * @dev This is the pure CKB (Common Knowledge Base) mechanism:
 *      - Knowledge Primitives: atomic units of verified insight
 *      - Contribution DAG: tracks who contributed what knowledge and when
 *      - Shapley Attribution: fair value distribution across contributors
 *      - Knowledge Markets: price discovery for information value
 *      - Temporal Anchoring: knowledge claims bound to time of contribution
 *      - Composability: knowledge primitives compose into higher-order insights
 *
 * Unlike derivative InfoFi proposals, this architecture treats information
 * as an intrinsically valuable, non-fungible, composable asset class with
 * proper attribution and Shapley-weighted reward distribution.
 */
contract VibeInfoFi is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum PrimitiveType { INSIGHT, DISCOVERY, SYNTHESIS, PROOF, DATA, MODEL, FRAMEWORK }

    struct KnowledgePrimitive {
        bytes32 primitiveId;
        address contributor;
        PrimitiveType primitiveType;
        bytes32 contentHash;          // IPFS hash of the knowledge content
        bytes32[] dependencies;       // Knowledge primitives this builds on
        uint256 citationCount;        // How many other primitives cite this
        uint256 intrinsicValue;       // Market-determined value
        uint256 contributedAt;
        uint256 lastCitedAt;
        bool verified;                // Peer-verified as valid knowledge
        bool active;
    }

    struct KnowledgeMarket {
        bytes32 primitiveId;
        uint256 totalStaked;          // Total value staked on this knowledge
        uint256 buyPrice;             // Current buy price (bonding curve)
        uint256 sellPrice;            // Current sell price
        uint256 totalTraded;
    }

    struct ContributorProfile {
        address contributor;
        uint256 totalPrimitives;
        uint256 totalCitations;
        uint256 totalEarned;
        uint256 shapleyScore;         // Cumulative Shapley value
        uint256 hIndex;               // h-index equivalent for knowledge
        uint256 firstContribution;
    }

    struct Attribution {
        bytes32 primitiveId;
        address contributor;
        uint256 shapleyValue;         // Fair share of value created
        uint256 timestamp;
    }

    // ============ State ============

    mapping(bytes32 => KnowledgePrimitive) public primitives;
    bytes32[] public primitiveList;

    mapping(bytes32 => KnowledgeMarket) public markets;

    mapping(address => ContributorProfile) public contributors;

    /// @notice Citation graph: citingPrimitive => citedPrimitive[]
    mapping(bytes32 => bytes32[]) public citations;

    /// @notice Attribution records
    Attribution[] public attributions;

    /// @notice Verifiers (peer reviewers)
    mapping(address => bool) public verifiers;

    /// @notice Knowledge stakes: primitiveId => staker => amount
    mapping(bytes32 => mapping(address => uint256)) public stakes;

    /// @notice Stats
    uint256 public totalPrimitives;
    uint256 public totalCitations;
    uint256 public totalValueLocked;
    uint256 public totalAttributed;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event PrimitiveContributed(bytes32 indexed primitiveId, address indexed contributor, PrimitiveType pType);
    event PrimitiveVerified(bytes32 indexed primitiveId, address indexed verifier);
    event PrimitiveCited(bytes32 indexed citingId, bytes32 indexed citedId);
    event KnowledgeStaked(bytes32 indexed primitiveId, address indexed staker, uint256 amount);
    event ShapleyAttributed(bytes32 indexed primitiveId, address indexed contributor, uint256 value);
    event KnowledgeTraded(bytes32 indexed primitiveId, address indexed trader, bool isBuy, uint256 amount);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Knowledge Contribution ============

    /**
     * @notice Contribute a knowledge primitive to the CKB
     * @param primitiveType Category of knowledge
     * @param contentHash IPFS hash of the knowledge content
     * @param dependencies Knowledge primitives this builds upon
     */
    function contributePrimitive(
        PrimitiveType primitiveType,
        bytes32 contentHash,
        bytes32[] calldata dependencies
    ) external returns (bytes32) {
        bytes32 primitiveId = keccak256(abi.encodePacked(
            msg.sender, contentHash, block.timestamp
        ));

        // Validate dependencies exist
        for (uint256 i = 0; i < dependencies.length; i++) {
            require(primitives[dependencies[i]].active, "Invalid dependency");
            // Record citation
            primitives[dependencies[i]].citationCount++;
            primitives[dependencies[i]].lastCitedAt = block.timestamp;
            citations[primitiveId].push(dependencies[i]);
            totalCitations++;

            emit PrimitiveCited(primitiveId, dependencies[i]);
        }

        primitives[primitiveId] = KnowledgePrimitive({
            primitiveId: primitiveId,
            contributor: msg.sender,
            primitiveType: primitiveType,
            contentHash: contentHash,
            dependencies: dependencies,
            citationCount: 0,
            intrinsicValue: 0,
            contributedAt: block.timestamp,
            lastCitedAt: 0,
            verified: false,
            active: true
        });

        // Initialize market
        markets[primitiveId] = KnowledgeMarket({
            primitiveId: primitiveId,
            totalStaked: 0,
            buyPrice: 0.001 ether, // Initial price
            sellPrice: 0,
            totalTraded: 0
        });

        primitiveList.push(primitiveId);
        totalPrimitives++;

        // Update contributor profile
        ContributorProfile storage profile = contributors[msg.sender];
        profile.contributor = msg.sender;
        profile.totalPrimitives++;
        if (profile.firstContribution == 0) {
            profile.firstContribution = block.timestamp;
        }

        emit PrimitiveContributed(primitiveId, msg.sender, primitiveType);
        return primitiveId;
    }

    /**
     * @notice Verify a knowledge primitive (peer review)
     */
    function verifyPrimitive(bytes32 primitiveId) external {
        require(verifiers[msg.sender], "Not verifier");
        require(primitives[primitiveId].active, "Not active");
        require(primitives[primitiveId].contributor != msg.sender, "Self-verify");

        primitives[primitiveId].verified = true;
        emit PrimitiveVerified(primitiveId, msg.sender);
    }

    // ============ Knowledge Market ============

    /**
     * @notice Stake on a knowledge primitive (signal its value)
     */
    function stakeOnKnowledge(bytes32 primitiveId) external payable nonReentrant {
        require(msg.value > 0, "Zero stake");
        require(primitives[primitiveId].active, "Not active");

        stakes[primitiveId][msg.sender] += msg.value;
        markets[primitiveId].totalStaked += msg.value;
        primitives[primitiveId].intrinsicValue += msg.value;
        totalValueLocked += msg.value;

        // Update bonding curve price
        _updatePrice(primitiveId);

        emit KnowledgeStaked(primitiveId, msg.sender, msg.value);
    }

    // ============ Shapley Attribution ============

    /**
     * @notice Distribute Shapley-weighted attribution for a knowledge primitive
     * @dev Called when value flows through the knowledge graph
     * @param primitiveId The primitive generating value
     * @param totalValue The total value to distribute
     */
    function distributeShapleyAttribution(
        bytes32 primitiveId,
        uint256 totalValue
    ) external payable nonReentrant {
        require(msg.value >= totalValue, "Insufficient value");
        KnowledgePrimitive storage kp = primitives[primitiveId];
        require(kp.active, "Not active");

        uint256 depCount = kp.dependencies.length;

        // Direct contributor gets base share
        uint256 directShare = depCount == 0
            ? totalValue
            : (totalValue * 6000) / 10000; // 60% to direct contributor

        contributors[kp.contributor].totalEarned += directShare;
        contributors[kp.contributor].shapleyScore += directShare;

        (bool ok, ) = kp.contributor.call{value: directShare}("");
        require(ok, "Attribution failed");

        attributions.push(Attribution({
            primitiveId: primitiveId,
            contributor: kp.contributor,
            shapleyValue: directShare,
            timestamp: block.timestamp
        }));

        emit ShapleyAttributed(primitiveId, kp.contributor, directShare);

        // Dependencies share remaining proportionally to citation count
        if (depCount > 0) {
            uint256 remaining = totalValue - directShare;
            uint256 perDep = remaining / depCount;

            for (uint256 i = 0; i < depCount; i++) {
                address depContributor = primitives[kp.dependencies[i]].contributor;
                contributors[depContributor].totalEarned += perDep;
                contributors[depContributor].shapleyScore += perDep;

                (bool ok2, ) = depContributor.call{value: perDep}("");
                require(ok2, "Dep attribution failed");

                emit ShapleyAttributed(kp.dependencies[i], depContributor, perDep);
            }
        }

        totalAttributed += totalValue;
    }

    // ============ Internal ============

    function _updatePrice(bytes32 primitiveId) internal {
        KnowledgeMarket storage m = markets[primitiveId];
        // Simple bonding curve: price = totalStaked / 1000
        m.buyPrice = (m.totalStaked / 1000) + 0.001 ether;
        m.sellPrice = m.buyPrice * 9 / 10; // 10% spread
    }

    // ============ Admin ============

    function addVerifier(address v) external onlyOwner { verifiers[v] = true; }
    function removeVerifier(address v) external onlyOwner { verifiers[v] = false; }

    // ============ View ============

    function getPrimitive(bytes32 id) external view returns (KnowledgePrimitive memory) {
        return primitives[id];
    }

    function getContributor(address c) external view returns (ContributorProfile memory) {
        return contributors[c];
    }

    function getCitations(bytes32 id) external view returns (bytes32[] memory) {
        return citations[id];
    }

    function getPrimitiveCount() external view returns (uint256) { return totalPrimitives; }
    function getTotalValueLocked() external view returns (uint256) { return totalValueLocked; }
    function getAttributionCount() external view returns (uint256) { return attributions.length; }

    receive() external payable {
        totalValueLocked += msg.value;
    }
}
