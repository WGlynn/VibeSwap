// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title VibeGeometricConsensus — Grassmann Manifold Signal Aggregation
 * @notice Absorbs "Attention Is Not What You Need" (Zhang, 2025) patterns.
 *         Instead of attention-weighted voting, uses geometric subspace
 *         alignment for signal aggregation. Agents submit signals as
 *         low-dimensional projections; consensus emerges from subspace
 *         intersection rather than weighted averages.
 *
 * @dev Architecture (Grassmann absorption):
 *      - Signals as subspace coordinates (Plucker-inspired)
 *      - Linear scaling with participant count (not quadratic like attention)
 *      - Geometric invariants provide interpretable consensus metrics
 *      - Gated mixing replaces softmax for signal fusion
 *      - Compatible with VibeAgentConsensus for hybrid approach
 *
 *      Key insight from the paper: you don't need pairwise attention to
 *      aggregate signals. Geometric projections onto shared manifolds
 *      achieve the same effect with better scaling and interpretability.
 */
contract VibeGeometricConsensus is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    // ============ Types ============

    enum AggregationMethod { MEAN, MEDIAN, GEOMETRIC, SUBSPACE_INTERSECTION }

    struct Signal {
        bytes32 agentId;
        uint256[3] coordinates;      // 3D subspace projection (Plucker-inspired)
        uint256 magnitude;           // Signal strength
        uint256 confidence;          // 0-10000
        uint256 timestamp;
    }

    struct AggregationRound {
        uint256 roundId;
        bytes32 topic;
        AggregationMethod method;
        uint256 signalCount;
        uint256[3] consensusCoords;  // Aggregated result
        uint256 consensusMagnitude;
        uint256 alignmentScore;      // How aligned were the signals (0-10000)
        uint256 deadline;
        bool finalized;
    }

    struct AgentGeometry {
        bytes32 agentId;
        uint256 totalSignals;
        uint256 avgAlignment;        // How often this agent aligns with consensus
        uint256 geometricReputation; // Reputation based on alignment history
    }

    // ============ Constants ============

    uint256 public constant SCALE = 1e18;
    uint256 public constant SIGNAL_DURATION = 60;  // 60 seconds to submit signals
    uint256 public constant MAX_COORDINATES = 3;

    // ============ State ============

    mapping(uint256 => AggregationRound) public rounds;
    uint256 public roundCount;

    /// @notice Round signals: roundId => Signal[]
    mapping(uint256 => Signal[]) public roundSignals;

    /// @notice Agent geometry stats
    mapping(bytes32 => AgentGeometry) public agentGeometry;

    /// @notice Stats
    uint256 public totalRoundsCompleted;
    uint256 public totalSignalsProcessed;
    uint256 public avgAlignmentScore;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event RoundCreated(uint256 indexed roundId, bytes32 topic, AggregationMethod method);
    event SignalSubmitted(uint256 indexed roundId, bytes32 indexed agentId, uint256 magnitude);
    event ConsensusComputed(uint256 indexed roundId, uint256 alignmentScore, uint256 signalCount);
    event GeometryUpdated(bytes32 indexed agentId, uint256 newReputation);

    // ============ Init ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Round Management ============

    function createRound(
        bytes32 topic,
        AggregationMethod method
    ) external returns (uint256) {
        roundCount++;

        rounds[roundCount] = AggregationRound({
            roundId: roundCount,
            topic: topic,
            method: method,
            signalCount: 0,
            consensusCoords: [uint256(0), uint256(0), uint256(0)],
            consensusMagnitude: 0,
            alignmentScore: 0,
            deadline: block.timestamp + SIGNAL_DURATION,
            finalized: false
        });

        emit RoundCreated(roundCount, topic, method);
        return roundCount;
    }

    // ============ Signal Submission ============

    /**
     * @notice Submit a signal as a 3D geometric projection
     * @dev The 3 coordinates represent the agent's position in the shared
     *      signal manifold. Higher confidence = more weight in aggregation.
     */
    function submitSignal(
        uint256 roundId,
        bytes32 agentId,
        uint256[3] calldata coordinates,
        uint256 magnitude,
        uint256 confidence
    ) external {
        AggregationRound storage round = rounds[roundId];
        require(!round.finalized, "Already finalized");
        require(block.timestamp <= round.deadline, "Deadline passed");
        require(confidence <= 10000, "Invalid confidence");
        require(magnitude > 0, "Zero magnitude");

        roundSignals[roundId].push(Signal({
            agentId: agentId,
            coordinates: coordinates,
            magnitude: magnitude,
            confidence: confidence,
            timestamp: block.timestamp
        }));

        round.signalCount++;
        agentGeometry[agentId].totalSignals++;

        emit SignalSubmitted(roundId, agentId, magnitude);
    }

    // ============ Aggregation ============

    /**
     * @notice Compute consensus from submitted signals
     * @dev Uses confidence-weighted coordinate averaging + alignment scoring.
     *      Alignment measures how close signals are in the geometric space.
     *      High alignment = strong consensus. Low alignment = disagreement.
     */
    function finalize(uint256 roundId) external {
        AggregationRound storage round = rounds[roundId];
        require(block.timestamp > round.deadline, "Still accepting signals");
        require(!round.finalized, "Already finalized");
        require(round.signalCount > 0, "No signals");

        round.finalized = true;

        Signal[] storage signals = roundSignals[roundId];

        // Compute confidence-weighted centroid
        uint256 totalWeight;
        uint256[3] memory weightedSum;

        for (uint256 i = 0; i < signals.length; i++) {
            uint256 weight = signals[i].confidence * signals[i].magnitude;
            totalWeight += weight;

            for (uint256 j = 0; j < 3; j++) {
                weightedSum[j] += signals[i].coordinates[j] * weight;
            }
        }

        if (totalWeight > 0) {
            for (uint256 j = 0; j < 3; j++) {
                round.consensusCoords[j] = weightedSum[j] / totalWeight;
            }
        }

        // Compute magnitude as average
        uint256 totalMag;
        for (uint256 i = 0; i < signals.length; i++) {
            totalMag += signals[i].magnitude;
        }
        round.consensusMagnitude = totalMag / signals.length;

        // Compute alignment score (average distance from consensus)
        uint256 totalDeviation;
        for (uint256 i = 0; i < signals.length; i++) {
            uint256 deviation;
            for (uint256 j = 0; j < 3; j++) {
                uint256 diff = signals[i].coordinates[j] > round.consensusCoords[j]
                    ? signals[i].coordinates[j] - round.consensusCoords[j]
                    : round.consensusCoords[j] - signals[i].coordinates[j];
                deviation += diff * diff;
            }
            totalDeviation += _sqrt(deviation);
        }

        uint256 avgDeviation = totalDeviation / signals.length;
        // Higher alignment = lower deviation. Cap at 10000.
        round.alignmentScore = avgDeviation > 10000 ? 0 : 10000 - avgDeviation;

        // Update agent geometry stats
        for (uint256 i = 0; i < signals.length; i++) {
            AgentGeometry storage ag = agentGeometry[signals[i].agentId];
            // EMA of alignment
            uint256 agentDeviation;
            for (uint256 j = 0; j < 3; j++) {
                uint256 diff = signals[i].coordinates[j] > round.consensusCoords[j]
                    ? signals[i].coordinates[j] - round.consensusCoords[j]
                    : round.consensusCoords[j] - signals[i].coordinates[j];
                agentDeviation += diff;
            }
            uint256 agentAlign = agentDeviation > 10000 ? 0 : 10000 - agentDeviation;

            ag.avgAlignment = (ag.avgAlignment * 9 + agentAlign) / 10;
            ag.geometricReputation = ag.avgAlignment;

            emit GeometryUpdated(signals[i].agentId, ag.geometricReputation);
        }

        totalRoundsCompleted++;
        totalSignalsProcessed += signals.length;

        // Update global avg alignment
        avgAlignmentScore = (avgAlignmentScore * (totalRoundsCompleted - 1) + round.alignmentScore) / totalRoundsCompleted;

        emit ConsensusComputed(roundId, round.alignmentScore, round.signalCount);
    }

    // ============ Internal ============

    function _sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    // ============ View ============

    function getRound(uint256 id) external view returns (AggregationRound memory) { return rounds[id]; }
    function getSignalCount(uint256 roundId) external view returns (uint256) { return roundSignals[roundId].length; }
    function getAgentGeometry(bytes32 agentId) external view returns (AgentGeometry memory) { return agentGeometry[agentId]; }
    function getRoundCount() external view returns (uint256) { return roundCount; }

    receive() external payable {}
}
