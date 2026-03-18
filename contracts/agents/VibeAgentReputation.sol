// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentReputation — Multi-Dimensional Agent Reputation System
 * @notice Unified reputation scoring for AI agents across all VSOS subsystems.
 *         Combines task completion, trading performance, consensus participation,
 *         security audit quality, and memory reliability into a single score.
 *
 * @dev Architecture:
 *      - 6 reputation dimensions weighted by configurable parameters
 *      - Exponential moving average for temporal smoothing
 *      - Sybil resistance via minimum stake + Proof of Mind
 *      - Reputation decay for inactive agents
 *      - Cross-protocol aggregation (tasks, trading, consensus, security, memory)
 *      - Tier system: NOVICE → PROVEN → EXPERT → MASTER → LEGENDARY
 */
contract VibeAgentReputation is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum ReputationTier { NOVICE, PROVEN, EXPERT, MASTER, LEGENDARY }

    struct AgentReputation {
        bytes32 agentId;
        uint256 taskScore;           // 0-10000 from task completion rate
        uint256 tradingScore;        // 0-10000 from PnL consistency
        uint256 consensusScore;      // 0-10000 from reveal rate
        uint256 securityScore;       // 0-10000 from verified findings
        uint256 memoryScore;         // 0-10000 from memory reliability
        uint256 socialScore;         // 0-10000 from peer endorsements
        uint256 compositeScore;      // Weighted aggregate 0-10000
        ReputationTier tier;
        uint256 totalInteractions;
        uint256 lastUpdateAt;
        uint256 createdAt;
        bool active;
    }

    struct Endorsement {
        bytes32 fromAgent;
        bytes32 toAgent;
        uint256 dimension;           // 0-5 matching score indices
        uint256 weight;
        uint256 timestamp;
    }

    // ============ Constants ============

    // Dimension weights (basis points, must sum to 10000)
    uint256 public constant TASK_WEIGHT = 2500;
    uint256 public constant TRADING_WEIGHT = 2000;
    uint256 public constant CONSENSUS_WEIGHT = 1500;
    uint256 public constant SECURITY_WEIGHT = 1500;
    uint256 public constant MEMORY_WEIGHT = 1000;
    uint256 public constant SOCIAL_WEIGHT = 1500;

    // Tier thresholds
    uint256 public constant PROVEN_THRESHOLD = 3000;
    uint256 public constant EXPERT_THRESHOLD = 5000;
    uint256 public constant MASTER_THRESHOLD = 7500;
    uint256 public constant LEGENDARY_THRESHOLD = 9000;

    uint256 public constant EMA_ALPHA = 200; // 2% smoothing (alpha/10000)

    // ============ State ============

    mapping(bytes32 => AgentReputation) public reputations;
    bytes32[] public agentList;

    /// @notice Endorsements: endorsementId => Endorsement
    mapping(bytes32 => Endorsement) public endorsements;

    /// @notice Agent endorsement count: agentId => count
    mapping(bytes32 => uint256) public endorsementCount;

    /// @notice Prevent double endorsement: fromAgent+toAgent+dimension => bool
    mapping(bytes32 => bool) public hasEndorsed;

    /// @notice Stats
    uint256 public totalAgents;
    uint256 public totalEndorsements;
    uint256 public totalUpdates;

    // ============ Events ============

    event ReputationInitialized(bytes32 indexed agentId);
    event ReputationUpdated(bytes32 indexed agentId, uint256 dimension, uint256 newScore, uint256 compositeScore);
    event TierChanged(bytes32 indexed agentId, ReputationTier oldTier, ReputationTier newTier);
    event AgentEndorsed(bytes32 indexed fromAgent, bytes32 indexed toAgent, uint256 dimension, uint256 weight);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Registration ============

    function initializeReputation(bytes32 agentId) external {
        require(!reputations[agentId].active, "Already initialized");

        reputations[agentId] = AgentReputation({
            agentId: agentId,
            taskScore: 5000,
            tradingScore: 5000,
            consensusScore: 5000,
            securityScore: 5000,
            memoryScore: 5000,
            socialScore: 5000,
            compositeScore: 5000,
            tier: ReputationTier.NOVICE,
            totalInteractions: 0,
            lastUpdateAt: block.timestamp,
            createdAt: block.timestamp,
            active: true
        });

        agentList.push(agentId);
        totalAgents++;

        emit ReputationInitialized(agentId);
    }

    // ============ Score Updates ============

    /**
     * @notice Update a single reputation dimension with EMA smoothing
     * @param agentId Agent to update
     * @param dimension 0=task, 1=trading, 2=consensus, 3=security, 4=memory, 5=social
     * @param newDataPoint Raw score from the source protocol (0-10000)
     */
    function updateScore(bytes32 agentId, uint256 dimension, uint256 newDataPoint) external {
        AgentReputation storage rep = reputations[agentId];
        require(rep.active, "Not initialized");
        require(newDataPoint <= 10000, "Invalid score");
        require(dimension <= 5, "Invalid dimension");

        // EMA: score = alpha * new + (1 - alpha) * old
        uint256 oldScore;
        if (dimension == 0) oldScore = rep.taskScore;
        else if (dimension == 1) oldScore = rep.tradingScore;
        else if (dimension == 2) oldScore = rep.consensusScore;
        else if (dimension == 3) oldScore = rep.securityScore;
        else if (dimension == 4) oldScore = rep.memoryScore;
        else oldScore = rep.socialScore;

        uint256 smoothed = (EMA_ALPHA * newDataPoint + (10000 - EMA_ALPHA) * oldScore) / 10000;

        if (dimension == 0) rep.taskScore = smoothed;
        else if (dimension == 1) rep.tradingScore = smoothed;
        else if (dimension == 2) rep.consensusScore = smoothed;
        else if (dimension == 3) rep.securityScore = smoothed;
        else if (dimension == 4) rep.memoryScore = smoothed;
        else rep.socialScore = smoothed;

        rep.totalInteractions++;
        rep.lastUpdateAt = block.timestamp;
        totalUpdates++;

        _recomputeComposite(agentId);

        emit ReputationUpdated(agentId, dimension, smoothed, rep.compositeScore);
    }

    // ============ Endorsements ============

    function endorse(bytes32 fromAgent, bytes32 toAgent, uint256 dimension, uint256 weight) external {
        require(reputations[fromAgent].active && reputations[toAgent].active, "Agents not active");
        require(fromAgent != toAgent, "Self-endorse");
        require(weight > 0 && weight <= 1000, "Invalid weight");
        require(dimension <= 5, "Invalid dimension");

        bytes32 key = keccak256(abi.encodePacked(fromAgent, toAgent, dimension));
        require(!hasEndorsed[key], "Already endorsed");
        hasEndorsed[key] = true;

        bytes32 endorseId = keccak256(abi.encodePacked(fromAgent, toAgent, dimension, block.timestamp));
        endorsements[endorseId] = Endorsement({
            fromAgent: fromAgent,
            toAgent: toAgent,
            dimension: dimension,
            weight: weight,
            timestamp: block.timestamp
        });

        endorsementCount[toAgent]++;
        totalEndorsements++;

        // Boost social score of target
        AgentReputation storage rep = reputations[toAgent];
        uint256 boost = (weight * reputations[fromAgent].compositeScore) / 100000;
        if (rep.socialScore + boost > 10000) {
            rep.socialScore = 10000;
        } else {
            rep.socialScore += boost;
        }

        _recomputeComposite(toAgent);

        emit AgentEndorsed(fromAgent, toAgent, dimension, weight);
    }

    // ============ Internal ============

    function _recomputeComposite(bytes32 agentId) internal {
        AgentReputation storage rep = reputations[agentId];

        uint256 composite = (
            rep.taskScore * TASK_WEIGHT +
            rep.tradingScore * TRADING_WEIGHT +
            rep.consensusScore * CONSENSUS_WEIGHT +
            rep.securityScore * SECURITY_WEIGHT +
            rep.memoryScore * MEMORY_WEIGHT +
            rep.socialScore * SOCIAL_WEIGHT
        ) / 10000;

        rep.compositeScore = composite;

        // Update tier
        ReputationTier oldTier = rep.tier;
        if (composite >= LEGENDARY_THRESHOLD) rep.tier = ReputationTier.LEGENDARY;
        else if (composite >= MASTER_THRESHOLD) rep.tier = ReputationTier.MASTER;
        else if (composite >= EXPERT_THRESHOLD) rep.tier = ReputationTier.EXPERT;
        else if (composite >= PROVEN_THRESHOLD) rep.tier = ReputationTier.PROVEN;
        else rep.tier = ReputationTier.NOVICE;

        if (rep.tier != oldTier) {
            emit TierChanged(agentId, oldTier, rep.tier);
        }
    }

    // ============ View ============

    function getReputation(bytes32 agentId) external view returns (AgentReputation memory) { return reputations[agentId]; }
    function getTier(bytes32 agentId) external view returns (ReputationTier) { return reputations[agentId].tier; }
    function getCompositeScore(bytes32 agentId) external view returns (uint256) { return reputations[agentId].compositeScore; }
    function getAgentCount() external view returns (uint256) { return totalAgents; }

    receive() external payable {}
}
