// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IEpistemicStaking.sol";

/**
 * @title EpistemicStaking
 * @notice Knowledge-weighted staking where prediction accuracy determines governance power.
 *         Part of the IT meta-pattern. Being right matters more than being rich.
 *         Flash-loan proof: knowledge can't be borrowed.
 *         Sybil-resistant: splitting identities doesn't increase total accuracy.
 *
 *         Mechanism:
 *         - Stakers record predictions on PredictionMarket outcomes
 *         - Authorized resolvers confirm actual outcomes
 *         - Accuracy EMA tracks prediction quality over time
 *         - Streak bonuses reward consistent accuracy
 *         - Inactivity decay prevents stale governance weight
 *         - Epistemic weight = accuracyEMA * streakMultiplier (after MIN_PREDICTIONS)
 */
contract EpistemicStaking is IEpistemicStaking, Ownable, ReentrancyGuard {

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant EMA_ALPHA = 0.2e18;            // 20% weight to new data
    uint256 public constant DECAY_RATE = 0.95e18;           // 5% decay per inactivity period
    uint256 public constant INACTIVITY_THRESHOLD = 50;      // Batches before decay kicks in
    uint256 public constant STREAK_BONUS_BPS = 500;         // 5% bonus per streak level
    uint256 public constant MAX_STREAK_BONUS = 5000;        // Max 50% bonus from streaks
    uint256 public constant MIN_PREDICTIONS = 5;            // Minimum predictions before weight counts

    // ============ State ============

    mapping(address => EpistemicProfile) private _profiles;
    mapping(bytes32 => PredictionRecord) private _predictions;
    mapping(address => bytes32[]) private _stakerPredictions;
    mapping(address => mapping(uint256 => bool)) private _marketPredicted;
    mapping(address => bool) public authorizedResolvers;

    uint256 public totalEpistemicWeight;
    uint64 public currentBatchId;

    // ============ Constructor ============

    constructor() Ownable(msg.sender) {}

    // ============ Core ============

    function recordPrediction(
        uint256 marketId,
        bool predictedYes,
        uint256 confidence
    ) external returns (bytes32 predictionId) {
        if (confidence == 0 || confidence > 100) revert InvalidConfidence();
        if (_marketPredicted[msg.sender][marketId]) revert MarketAlreadyPredicted();

        predictionId = keccak256(abi.encodePacked(msg.sender, marketId, block.timestamp));

        _predictions[predictionId] = PredictionRecord({
            predictionId: predictionId,
            staker: msg.sender,
            marketId: marketId,
            predictedYes: predictedYes,
            confidence: confidence,
            timestamp: uint64(block.timestamp),
            resolved: false,
            correct: false
        });

        _stakerPredictions[msg.sender].push(predictionId);
        _marketPredicted[msg.sender][marketId] = true;

        // Initialize profile if new staker
        EpistemicProfile storage profile = _profiles[msg.sender];
        if (!profile.active) {
            profile.staker = msg.sender;
            profile.active = true;
            profile.lastActivity = uint64(block.number);
            emit StakerActivated(msg.sender);
        }

        emit PredictionRecorded(predictionId, msg.sender, marketId, predictedYes, confidence);
    }

    function resolvePrediction(
        bytes32 predictionId,
        bool actualOutcomeYes
    ) external {
        if (!authorizedResolvers[msg.sender] && msg.sender != owner()) revert NotAuthorized();

        PredictionRecord storage prediction = _predictions[predictionId];
        if (prediction.staker == address(0)) revert PredictionNotFound();
        if (prediction.resolved) revert AlreadyResolved();

        bool correct = (prediction.predictedYes == actualOutcomeYes);
        prediction.resolved = true;
        prediction.correct = correct;

        // Update epistemic profile
        EpistemicProfile storage profile = _profiles[prediction.staker];
        uint256 oldWeight = profile.epistemicWeight;

        profile.totalPredictions++;

        if (correct) {
            profile.correctPredictions++;
            profile.streak++;
            if (profile.streak > profile.longestStreak) {
                profile.longestStreak = profile.streak;
            }
        } else {
            profile.streak = 0;
        }

        // Compute new accuracy data point: correct ? confidence-scaled : 0
        uint256 newDataPoint = correct
            ? (prediction.confidence * PRECISION) / 100
            : 0;

        // Update accuracy EMA: alpha * new + (1 - alpha) * old
        profile.accuracyEMA = (EMA_ALPHA * newDataPoint + (PRECISION - EMA_ALPHA) * profile.accuracyEMA) / PRECISION;

        // Compute new epistemic weight
        uint256 newWeight;
        if (profile.totalPredictions >= MIN_PREDICTIONS) {
            newWeight = (profile.accuracyEMA * _streakMultiplier(profile.streak)) / PRECISION;
        }
        // else newWeight remains 0

        profile.epistemicWeight = newWeight;
        profile.lastActivity = uint64(block.number);

        // Update global total
        totalEpistemicWeight = totalEpistemicWeight - oldWeight + newWeight;

        emit PredictionResolved(predictionId, prediction.staker, correct, profile.accuracyEMA, newWeight);
        emit EpistemicWeightUpdated(prediction.staker, oldWeight, newWeight);
    }

    function applyInactivityDecay(address staker) external {
        EpistemicProfile storage profile = _profiles[staker];
        if (!profile.active) revert StakerNotActive();

        // Block-based inactivity approximation
        uint256 blocksSinceActivity = block.number - uint256(profile.lastActivity);
        uint256 inactiveBatches = blocksSinceActivity / INACTIVITY_THRESHOLD;

        if (inactiveBatches == 0) return;

        uint256 oldWeight = profile.epistemicWeight;
        uint256 decayedWeight = oldWeight;

        // Apply compounding decay for each inactive period
        for (uint256 i = 0; i < inactiveBatches; i++) {
            decayedWeight = (decayedWeight * DECAY_RATE) / PRECISION;
        }

        profile.epistemicWeight = decayedWeight;

        // Update global total
        totalEpistemicWeight = totalEpistemicWeight - oldWeight + decayedWeight;

        emit InactivityDecayApplied(staker, oldWeight, decayedWeight, inactiveBatches);
    }

    // ============ Admin ============

    function addResolver(address resolver) external onlyOwner {
        if (resolver == address(0)) revert ZeroAddress();
        authorizedResolvers[resolver] = true;
    }

    function removeResolver(address resolver) external onlyOwner {
        authorizedResolvers[resolver] = false;
    }

    function updateBatchId(uint64 batchId) external onlyOwner {
        currentBatchId = batchId;
    }

    // ============ Views ============

    function getEpistemicWeight(address staker) external view returns (uint256) {
        return _profiles[staker].epistemicWeight;
    }

    function getProfile(address staker) external view returns (EpistemicProfile memory) {
        return _profiles[staker];
    }

    function getPrediction(bytes32 predictionId) external view returns (PredictionRecord memory) {
        return _predictions[predictionId];
    }

    function getStakerPredictions(address staker) external view returns (bytes32[] memory) {
        return _stakerPredictions[staker];
    }

    function getTotalEpistemicWeight() external view returns (uint256) {
        return totalEpistemicWeight;
    }

    function getAccuracy(address staker) external view returns (uint256) {
        return _profiles[staker].accuracyEMA;
    }

    // ============ Internal ============

    /**
     * @dev Compute streak multiplier: base 1.0 + up to 0.5 bonus from streaks.
     *      Each streak level adds STREAK_BONUS_BPS (5%), capped at MAX_STREAK_BONUS (50%).
     * @param streak Current consecutive correct predictions
     * @return multiplier Multiplier in PRECISION scale (1e18 = 1.0x, 1.5e18 = 1.5x)
     */
    function _streakMultiplier(uint256 streak) internal pure returns (uint256) {
        uint256 bonusBps = streak * STREAK_BONUS_BPS;
        if (bonusBps > MAX_STREAK_BONUS) {
            bonusBps = MAX_STREAK_BONUS;
        }
        return PRECISION + (bonusBps * PRECISION) / 10000;
    }
}
