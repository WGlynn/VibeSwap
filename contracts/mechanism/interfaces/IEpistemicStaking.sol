// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IEpistemicStaking
 * @notice Interface for the Epistemic Staking mechanism — knowledge IS capital.
 *         Part of the IT meta-pattern. Governance weight is determined by demonstrated
 *         prediction accuracy, not capital amount. Being right matters more than being rich.
 *         Integrates with PredictionMarket outcomes to track accuracy.
 *         Sybil-resistant: splitting identities doesn't increase total accuracy.
 *         Flash-loan proof: knowledge can't be borrowed.
 */
interface IEpistemicStaking {

    // ============ Structs ============

    struct EpistemicProfile {
        address staker;
        uint256 totalPredictions;
        uint256 correctPredictions;
        uint256 accuracyEMA;           // EMA of accuracy (1e18 scale, 1e18 = 100%)
        uint256 epistemicWeight;        // Governance weight derived from accuracy
        uint256 confidenceSum;          // Sum of confidence-weighted outcomes
        uint64 lastActivity;
        uint256 streak;                 // Consecutive correct predictions
        uint256 longestStreak;
        bool active;
    }

    struct PredictionRecord {
        bytes32 predictionId;
        address staker;
        uint256 marketId;               // PredictionMarket ID
        bool predictedYes;
        uint256 confidence;             // 1-100 scale
        uint64 timestamp;
        bool resolved;
        bool correct;
    }

    // ============ Events ============

    event PredictionRecorded(
        bytes32 indexed predictionId,
        address indexed staker,
        uint256 indexed marketId,
        bool predictedYes,
        uint256 confidence
    );

    event PredictionResolved(
        bytes32 indexed predictionId,
        address indexed staker,
        bool correct,
        uint256 newAccuracyEMA,
        uint256 newEpistemicWeight
    );

    event EpistemicWeightUpdated(
        address indexed staker,
        uint256 oldWeight,
        uint256 newWeight
    );

    event InactivityDecayApplied(
        address indexed staker,
        uint256 oldWeight,
        uint256 newWeight,
        uint256 inactiveBatches
    );

    event StakerActivated(address indexed staker);

    // ============ Errors ============

    error ZeroAddress();
    error InvalidConfidence();
    error MarketNotResolved();
    error AlreadyResolved();
    error PredictionNotFound();
    error StakerNotActive();
    error NotAuthorized();
    error MarketAlreadyPredicted();

    // ============ Core ============

    /**
     * @notice Record a prediction for a PredictionMarket outcome
     * @param marketId The PredictionMarket ID being predicted on
     * @param predictedYes Whether the staker predicts YES outcome
     * @param confidence Confidence level (1-100)
     * @return predictionId Unique identifier for this prediction
     */
    function recordPrediction(
        uint256 marketId,
        bool predictedYes,
        uint256 confidence
    ) external returns (bytes32 predictionId);

    /**
     * @notice Resolve a prediction against actual market outcome
     * @dev Called by authorized resolver (PredictionMarket contract or keeper)
     * @param predictionId The prediction to resolve
     * @param actualOutcomeYes The actual market outcome
     */
    function resolvePrediction(
        bytes32 predictionId,
        bool actualOutcomeYes
    ) external;

    /**
     * @notice Apply inactivity decay to a staker who hasn't predicted recently
     * @param staker Address of the staker
     */
    function applyInactivityDecay(address staker) external;

    // ============ Views ============

    /**
     * @notice Get the epistemic weight (governance power) of a staker
     */
    function getEpistemicWeight(address staker) external view returns (uint256);

    /**
     * @notice Get full epistemic profile of a staker
     */
    function getProfile(address staker) external view returns (EpistemicProfile memory);

    /**
     * @notice Get a specific prediction record
     */
    function getPrediction(bytes32 predictionId) external view returns (PredictionRecord memory);

    /**
     * @notice Get all prediction IDs for a staker
     */
    function getStakerPredictions(address staker) external view returns (bytes32[] memory);

    /**
     * @notice Get total epistemic weight across all active stakers
     */
    function getTotalEpistemicWeight() external view returns (uint256);

    /**
     * @notice Get the accuracy EMA for a staker (1e18 scale)
     */
    function getAccuracy(address staker) external view returns (uint256);
}
