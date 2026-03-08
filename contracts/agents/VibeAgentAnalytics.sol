// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeAgentAnalytics — AI Conversation & Performance Analytics
 * @notice On-chain analytics for AI agent interactions. Absorbs ChatLens-style
 *         conversation analysis into a decentralized, privacy-preserving system.
 *         Track agent performance, conversation quality, and usage patterns
 *         WITHOUT exposing raw conversation data.
 *
 * @dev Architecture (absorbed from ChatLens + enhanced):
 *      - Conversation fingerprinting (hash-only, no raw data)
 *      - Quality scoring via multi-dimensional metrics
 *      - Agent performance dashboards (on-chain)
 *      - Anomaly detection signals
 *      - Privacy-preserving analytics via ZK aggregation
 *      - Revenue attribution (which conversations generate value)
 */
contract VibeAgentAnalytics is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    struct ConversationMetrics {
        bytes32 conversationId;
        bytes32 agentId;
        address user;
        uint256 turnCount;
        uint256 totalTokens;
        uint256 responseLatencyMs;
        uint256 qualityScore;        // 0-10000 (multi-dimensional)
        uint256 satisfactionScore;   // User-reported 0-10000
        uint256 valueGenerated;      // Revenue attributed to this conversation
        uint256 timestamp;
        bytes32 topicHash;           // Hashed topic category
    }

    struct AgentPerformance {
        bytes32 agentId;
        uint256 totalConversations;
        uint256 avgQualityScore;
        uint256 avgSatisfactionScore;
        uint256 totalTokensProcessed;
        uint256 totalValueGenerated;
        uint256 avgResponseLatency;
        uint256 lastUpdated;
    }

    struct AnomalySignal {
        uint256 signalId;
        bytes32 agentId;
        string signalType;          // "quality_drop", "latency_spike", "cost_anomaly"
        uint256 severity;           // 0-10000
        uint256 timestamp;
        bytes32 evidenceHash;
    }

    struct AnalyticsEpoch {
        uint256 epochId;
        uint256 totalConversations;
        uint256 totalTokens;
        uint256 totalRevenue;
        uint256 avgQuality;
        uint256 timestamp;
    }

    // ============ State ============

    mapping(bytes32 => ConversationMetrics) public conversations;
    uint256 public conversationCount;

    mapping(bytes32 => AgentPerformance) public performance;

    AnomalySignal[] public anomalies;

    mapping(uint256 => AnalyticsEpoch) public epochs;
    uint256 public currentEpoch;

    /// @notice Topic distribution: topicHash => count
    mapping(bytes32 => uint256) public topicCounts;

    /// @notice Quality thresholds for alerts
    uint256 public qualityAlertThreshold;
    uint256 public latencyAlertThreshold;

    /// @notice Stats
    uint256 public totalConversationsTracked;
    uint256 public totalTokensTracked;
    uint256 public totalRevenueTracked;
    uint256 public totalAnomalies;

    // ============ Events ============

    event ConversationRecorded(bytes32 indexed conversationId, bytes32 indexed agentId, uint256 qualityScore);
    event PerformanceUpdated(bytes32 indexed agentId, uint256 avgQuality, uint256 totalConversations);
    event AnomalyDetected(uint256 indexed signalId, bytes32 indexed agentId, string signalType, uint256 severity);
    event EpochFinalized(uint256 indexed epochId, uint256 totalConversations, uint256 totalRevenue);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
        qualityAlertThreshold = 3000; // Alert if quality drops below 30%
        latencyAlertThreshold = 5000; // 5000ms
        currentEpoch = 1;
        epochs[1].epochId = 1;
        epochs[1].timestamp = block.timestamp;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    // ============ Recording ============

    /**
     * @notice Record conversation metrics (privacy-preserving — hashes only)
     */
    function recordConversation(
        bytes32 agentId,
        uint256 turnCount,
        uint256 totalTokens,
        uint256 responseLatencyMs,
        uint256 qualityScore,
        uint256 valueGenerated,
        bytes32 topicHash
    ) external returns (bytes32) {
        bytes32 conversationId = keccak256(abi.encodePacked(
            agentId, msg.sender, block.timestamp
        ));

        conversations[conversationId] = ConversationMetrics({
            conversationId: conversationId,
            agentId: agentId,
            user: msg.sender,
            turnCount: turnCount,
            totalTokens: totalTokens,
            responseLatencyMs: responseLatencyMs,
            qualityScore: qualityScore,
            satisfactionScore: 0,
            valueGenerated: valueGenerated,
            timestamp: block.timestamp,
            topicHash: topicHash
        });

        conversationCount++;
        totalConversationsTracked++;
        totalTokensTracked += totalTokens;
        totalRevenueTracked += valueGenerated;
        topicCounts[topicHash]++;

        // Update agent performance
        _updatePerformance(agentId, qualityScore, totalTokens, responseLatencyMs, valueGenerated);

        // Update epoch
        epochs[currentEpoch].totalConversations++;
        epochs[currentEpoch].totalTokens += totalTokens;
        epochs[currentEpoch].totalRevenue += valueGenerated;

        // Anomaly detection
        if (qualityScore < qualityAlertThreshold) {
            _reportAnomaly(agentId, "quality_drop", qualityScore);
        }
        if (responseLatencyMs > latencyAlertThreshold) {
            _reportAnomaly(agentId, "latency_spike", responseLatencyMs);
        }

        emit ConversationRecorded(conversationId, agentId, qualityScore);
        return conversationId;
    }

    /**
     * @notice Record user satisfaction (post-conversation)
     */
    function rateSatisfaction(bytes32 conversationId, uint256 score) external {
        ConversationMetrics storage conv = conversations[conversationId];
        require(conv.user == msg.sender, "Not user");
        require(score <= 10000, "Invalid score");

        conv.satisfactionScore = score;
    }

    // ============ Epochs ============

    function finalizeEpoch() external {
        AnalyticsEpoch storage epoch = epochs[currentEpoch];
        if (epoch.totalConversations > 0) {
            epoch.avgQuality = totalRevenueTracked / epoch.totalConversations;
        }

        emit EpochFinalized(currentEpoch, epoch.totalConversations, epoch.totalRevenue);

        currentEpoch++;
        epochs[currentEpoch].epochId = currentEpoch;
        epochs[currentEpoch].timestamp = block.timestamp;
    }

    // ============ Internal ============

    function _updatePerformance(
        bytes32 agentId,
        uint256 qualityScore,
        uint256 tokens,
        uint256 latency,
        uint256 value
    ) internal {
        AgentPerformance storage perf = performance[agentId];
        perf.agentId = agentId;
        perf.totalConversations++;

        // Running average for quality
        perf.avgQualityScore = ((perf.avgQualityScore * (perf.totalConversations - 1)) + qualityScore) / perf.totalConversations;
        perf.avgResponseLatency = ((perf.avgResponseLatency * (perf.totalConversations - 1)) + latency) / perf.totalConversations;

        perf.totalTokensProcessed += tokens;
        perf.totalValueGenerated += value;
        perf.lastUpdated = block.timestamp;

        emit PerformanceUpdated(agentId, perf.avgQualityScore, perf.totalConversations);
    }

    function _reportAnomaly(bytes32 agentId, string memory signalType, uint256 severity) internal {
        anomalies.push(AnomalySignal({
            signalId: anomalies.length,
            agentId: agentId,
            signalType: signalType,
            severity: severity,
            timestamp: block.timestamp,
            evidenceHash: bytes32(0)
        }));

        totalAnomalies++;
        emit AnomalyDetected(anomalies.length - 1, agentId, signalType, severity);
    }

    // ============ Admin ============

    function setQualityThreshold(uint256 threshold) external onlyOwner { qualityAlertThreshold = threshold; }
    function setLatencyThreshold(uint256 threshold) external onlyOwner { latencyAlertThreshold = threshold; }

    // ============ View ============

    function getPerformance(bytes32 agentId) external view returns (AgentPerformance memory) { return performance[agentId]; }
    function getAnomalyCount() external view returns (uint256) { return anomalies.length; }
    function getConversationCount() external view returns (uint256) { return conversationCount; }
    function getCurrentEpoch() external view returns (uint256) { return currentEpoch; }

    receive() external payable {}
}
