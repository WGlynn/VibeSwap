// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "./IPriorityRegistry.sol";

/**
 * @title PriorityRegistry
 * @notice Immutable on-chain record of first-to-publish priority
 * @dev Tracks who was chronologically first to perform foundational acts
 *      (pool creation, liquidity bootstrapping, strategy authorship, infrastructure).
 *
 * Design principles:
 * - First-come-first-served: once recorded, priority cannot be overwritten
 * - Immutable: records persist forever (only deactivatable by owner for fraud)
 * - Category-weighted: different acts carry different weights
 * - Scope-based: priority is per (scopeId, category) — typically scopeId = poolId
 *
 * Integration:
 * - Authorized recorders (VibeAMM, VibeSwapCore, governance) call recordPriority()
 * - ShapleyDistributor queries getPioneerScore() during reward computation
 * - Pioneer bonus is applied as a Shapley weight multiplier (1.0x to 1.5x)
 *
 * See: docs/TIME_NEUTRAL_TOKENOMICS.md §5 "First-to-Publish Priority"
 */
contract PriorityRegistry is
    IPriorityRegistry,
    IPriorityRecorder,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    // ============ Enums ============

    enum Category {
        POOL_CREATION,        // First to create a trading pair
        LIQUIDITY_BOOTSTRAP,  // First to provide significant liquidity
        STRATEGY_AUTHOR,      // First to publish a verified strategy
        INFRASTRUCTURE        // First to deploy supporting infrastructure
    }

    // ============ Structs ============

    struct Record {
        address pioneer;
        uint256 timestamp;
        uint256 blockNumber;
        Category category;
        bool active;
    }

    // ============ Constants ============

    uint256 public constant BPS_PRECISION = 10000;

    // Category weights (in BPS) — higher = more foundational
    uint256 public constant POOL_CREATION_WEIGHT = 10000;       // 100% — created the market
    uint256 public constant LIQUIDITY_BOOTSTRAP_WEIGHT = 7500;  // 75% — funded the market
    uint256 public constant STRATEGY_AUTHOR_WEIGHT = 5000;      // 50% — designed the approach
    uint256 public constant INFRASTRUCTURE_WEIGHT = 5000;       // 50% — built the tooling

    uint256 private constant NUM_CATEGORIES = 4;

    // ============ State ============

    // scopeId => category => Record (one pioneer per scope+category)
    mapping(bytes32 => mapping(Category => Record)) public records;

    // pioneer address => scopeId => true if pioneer in any category
    mapping(address => mapping(bytes32 => bool)) public isPioneerOf;

    // pioneer address => total number of priority records
    mapping(address => uint256) public pioneerRecordCount;

    // Authorized recorders (VibeAMM, VibeSwapCore, governance)
    mapping(address => bool) public authorizedRecorders;

    // ============ Events ============

    event PriorityRecorded(
        bytes32 indexed scopeId,
        Category indexed category,
        address indexed pioneer,
        uint256 timestamp
    );

    event PriorityDeactivated(
        bytes32 indexed scopeId,
        Category indexed category,
        address pioneer
    );

    // ============ Errors ============

    error PriorityAlreadyClaimed();
    error Unauthorized();
    error ZeroAddress();
    error RecordNotFound();

    // ============ Modifiers ============

    modifier onlyAuthorized() {
        if (!authorizedRecorders[msg.sender] && msg.sender != owner()) {
            revert Unauthorized();
        }
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _owner) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
    }

    // ============ Core Functions ============

    /**
     * @notice Record a first-to-publish priority
     * @dev First-come-first-served. Reverts if priority already claimed for this (scope, category).
     * @param scopeId Scope identifier (typically poolId = keccak256(token0, token1))
     * @param category Type of foundational act
     * @param pioneer Address of the first publisher
     */
    function recordPriority(
        bytes32 scopeId,
        Category category,
        address pioneer
    ) external onlyAuthorized {
        if (pioneer == address(0)) revert ZeroAddress();

        Record storage record = records[scopeId][category];
        if (record.pioneer != address(0)) revert PriorityAlreadyClaimed();

        record.pioneer = pioneer;
        record.timestamp = block.timestamp;
        record.blockNumber = block.number;
        record.category = category;
        record.active = true;

        isPioneerOf[pioneer][scopeId] = true;
        pioneerRecordCount[pioneer]++;

        emit PriorityRecorded(scopeId, category, pioneer, block.timestamp);
    }

    /**
     * @notice Deactivate a priority record (fraud/error correction)
     * @dev Owner only. Does not delete — just marks inactive so history is preserved.
     * @param scopeId Scope identifier
     * @param category Category to deactivate
     */
    function deactivateRecord(
        bytes32 scopeId,
        Category category
    ) external onlyOwner {
        Record storage record = records[scopeId][category];
        if (record.pioneer == address(0)) revert RecordNotFound();

        address pioneer = record.pioneer;
        record.active = false;

        // Decrement count and update isPioneerOf if no active records remain
        if (pioneerRecordCount[pioneer] > 0) {
            pioneerRecordCount[pioneer]--;
        }
        if (pioneerRecordCount[pioneer] == 0) {
            isPioneerOf[pioneer][scopeId] = false;
        }

        emit PriorityDeactivated(scopeId, category, pioneer);
    }

    // ============ View Functions (IPriorityRegistry) ============

    /**
     * @notice Get pioneer score for a participant in a given scope
     * @dev Sums category weights for all active records where participant is pioneer.
     *      Score range: 0 (not a pioneer) to 32500 (pioneer in all 4 categories).
     *      ShapleyDistributor caps the bonus at PIONEER_BONUS_MAX_BPS.
     * @param participant Address to check
     * @param scopeId Scope identifier
     * @return score Sum of category weights (BPS)
     */
    function getPioneerScore(
        address participant,
        bytes32 scopeId
    ) external view override returns (uint256 score) {
        for (uint256 i = 0; i < NUM_CATEGORIES; i++) {
            Record storage record = records[scopeId][Category(i)];
            if (record.pioneer == participant && record.active) {
                score += _categoryWeight(Category(i));
            }
        }
    }

    /**
     * @notice Check if participant is a pioneer in any category for a scope
     * @param participant Address to check
     * @param scopeId Scope identifier
     * @return True if pioneer in at least one active category
     */
    function isPioneer(
        address participant,
        bytes32 scopeId
    ) external view override returns (bool) {
        return isPioneerOf[participant][scopeId];
    }

    // ============ Additional View Functions ============

    /**
     * @notice Get the pioneer address for a specific (scope, category)
     */
    function getPioneer(
        bytes32 scopeId,
        Category category
    ) external view returns (address) {
        return records[scopeId][category].pioneer;
    }

    /**
     * @notice Get full record for a specific (scope, category)
     */
    function getRecord(
        bytes32 scopeId,
        Category category
    ) external view returns (Record memory) {
        return records[scopeId][category];
    }

    // ============ Internal ============

    function _categoryWeight(Category cat) internal pure returns (uint256) {
        if (cat == Category.POOL_CREATION) return POOL_CREATION_WEIGHT;
        if (cat == Category.LIQUIDITY_BOOTSTRAP) return LIQUIDITY_BOOTSTRAP_WEIGHT;
        if (cat == Category.STRATEGY_AUTHOR) return STRATEGY_AUTHOR_WEIGHT;
        if (cat == Category.INFRASTRUCTURE) return INFRASTRUCTURE_WEIGHT;
        return 0;
    }

    // ============ IPriorityRecorder ============

    /**
     * @notice Convenience wrapper for recording pool creation priority
     * @dev Called by VibeAMM.createPool() via IPriorityRecorder interface
     */
    function recordPoolCreation(bytes32 scopeId, address pioneer) external override onlyAuthorized {
        if (pioneer == address(0)) revert ZeroAddress();

        Record storage record = records[scopeId][Category.POOL_CREATION];
        if (record.pioneer != address(0)) revert PriorityAlreadyClaimed();

        record.pioneer = pioneer;
        record.timestamp = block.timestamp;
        record.blockNumber = block.number;
        record.category = Category.POOL_CREATION;
        record.active = true;

        isPioneerOf[pioneer][scopeId] = true;
        pioneerRecordCount[pioneer]++;

        emit PriorityRecorded(scopeId, Category.POOL_CREATION, pioneer, block.timestamp);
    }

    // ============ Admin ============

    function setAuthorizedRecorder(address recorder, bool authorized) external onlyOwner {
        authorizedRecorders[recorder] = authorized;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
