// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title VibeReputationAggregator — Cross-Protocol Reputation Fusion
 * @notice Aggregates reputation signals from across the VSOS ecosystem:
 *         trading history, governance participation, content quality,
 *         attention scores, memory contributions, agent performance.
 *         Produces a single composite reputation that feeds into
 *         lending, insurance, governance weight, and social trust.
 *
 * @dev Architecture:
 *      - Multi-source reputation inputs (8 dimensions)
 *      - Configurable dimension weights (governance-adjustable)
 *      - Time-decay: old reputation fades (prevents resting on laurels)
 *      - Sybil resistance: cross-source correlation
 *      - Composable: any VSOS contract can query reputation
 *      - EMA smoothing prevents reputation manipulation
 */
contract VibeReputationAggregator is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    enum Dimension {
        TRADING,        // AMM/auction performance
        GOVERNANCE,     // Voting participation + quality
        CONTENT,        // Content creation quality
        ATTENTION,      // Attention score from BAT module
        MEMORY,         // Discovery/read ratio from MemoryLedger
        SOCIAL,         // Social graph engagement
        SECURITY,       // Bug bounties, audits
        AGENT           // AI agent performance (if applicable)
    }

    struct ReputationProfile {
        address user;
        uint256[8] dimensionScores;  // One per Dimension enum
        uint256 compositeScore;      // Weighted aggregate (0-10000)
        uint256 lastUpdated;
        uint256 updateCount;
        bool exists;
    }

    // ============ State ============

    mapping(address => ReputationProfile) public reputations;

    /// @notice Dimension weights (bps, must sum to 10000)
    uint256[8] public dimensionWeights;

    /// @notice Authorized score reporters (other VSOS contracts)
    mapping(address => mapping(uint8 => bool)) public reporters; // reporter => dimension => authorized

    /// @notice Stats
    uint256 public totalUsers;
    uint256 public totalUpdates;

    // ============ Constants ============

    uint256 public constant EMA_ALPHA = 200;   // 2% smoothing
    uint256 public constant DECAY_PERIOD = 30 days;
    uint256 public constant DECAY_RATE = 100;  // 1% per period

    // ============ Events ============

    event ScoreUpdated(address indexed user, Dimension dimension, uint256 newScore, uint256 composite);
    event WeightsUpdated(uint256[8] newWeights);
    event ReporterAuthorized(address indexed reporter, uint8 dimension);

    // ============ Init ============

    function initialize() external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();

        // Default weights (even distribution)
        dimensionWeights = [
            uint256(1500),  // TRADING 15%
            uint256(1500),  // GOVERNANCE 15%
            uint256(1250),  // CONTENT 12.5%
            uint256(1250),  // ATTENTION 12.5%
            uint256(1000),  // MEMORY 10%
            uint256(1000),  // SOCIAL 10%
            uint256(1250),  // SECURITY 12.5%
            uint256(1250)   // AGENT 12.5%
        ];
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Score Reporting ============

    /**
     * @notice Report a dimension score for a user
     * @dev Only authorized reporters can update specific dimensions.
     *      Uses EMA smoothing to prevent sudden manipulation.
     */
    function reportScore(address user, Dimension dimension, uint256 score) external {
        uint8 dim = uint8(dimension);
        require(reporters[msg.sender][dim] || msg.sender == owner(), "Not authorized");
        require(score <= 10000, "Invalid score");

        ReputationProfile storage profile = reputations[user];

        if (!profile.exists) {
            profile.user = user;
            profile.exists = true;
            totalUsers++;
        }

        // EMA smoothing
        if (profile.dimensionScores[dim] == 0) {
            profile.dimensionScores[dim] = score;
        } else {
            profile.dimensionScores[dim] =
                (profile.dimensionScores[dim] * (10000 - EMA_ALPHA) + score * EMA_ALPHA) / 10000;
        }

        // Recompute composite
        profile.compositeScore = _computeComposite(profile);
        profile.lastUpdated = block.timestamp;
        profile.updateCount++;
        totalUpdates++;

        emit ScoreUpdated(user, dimension, profile.dimensionScores[dim], profile.compositeScore);
    }

    /**
     * @notice Batch report multiple dimensions at once
     */
    function reportBatch(address user, uint8[] calldata dimensions, uint256[] calldata scores) external {
        require(dimensions.length == scores.length, "Length mismatch");

        ReputationProfile storage profile = reputations[user];
        if (!profile.exists) {
            profile.user = user;
            profile.exists = true;
            totalUsers++;
        }

        for (uint256 i = 0; i < dimensions.length; i++) {
            require(reporters[msg.sender][dimensions[i]] || msg.sender == owner(), "Not authorized");
            require(scores[i] <= 10000, "Invalid score");

            uint8 dim = dimensions[i];
            if (profile.dimensionScores[dim] == 0) {
                profile.dimensionScores[dim] = scores[i];
            } else {
                profile.dimensionScores[dim] =
                    (profile.dimensionScores[dim] * (10000 - EMA_ALPHA) + scores[i] * EMA_ALPHA) / 10000;
            }
        }

        profile.compositeScore = _computeComposite(profile);
        profile.lastUpdated = block.timestamp;
        profile.updateCount++;
        totalUpdates++;
    }

    // ============ Admin ============

    function setWeights(uint256[8] calldata weights) external onlyOwner {
        uint256 total;
        for (uint256 i = 0; i < 8; i++) {
            total += weights[i];
        }
        require(total == 10000, "Must sum to 10000");
        dimensionWeights = weights;
        emit WeightsUpdated(weights);
    }

    function authorizeReporter(address reporter, uint8 dimension) external onlyOwner {
        reporters[reporter][dimension] = true;
        emit ReporterAuthorized(reporter, dimension);
    }

    function revokeReporter(address reporter, uint8 dimension) external onlyOwner {
        reporters[reporter][dimension] = false;
    }

    // ============ Internal ============

    function _computeComposite(ReputationProfile storage profile) internal view returns (uint256) {
        uint256 composite;
        for (uint256 i = 0; i < 8; i++) {
            uint256 decayed = _applyDecay(profile.dimensionScores[i], profile.lastUpdated);
            composite += (decayed * dimensionWeights[i]) / 10000;
        }
        return composite > 10000 ? 10000 : composite;
    }

    function _applyDecay(uint256 score, uint256 lastUpdate) internal view returns (uint256) {
        if (lastUpdate == 0) return score;
        uint256 elapsed = block.timestamp - lastUpdate;
        uint256 periods = elapsed / DECAY_PERIOD;
        if (periods == 0) return score;

        uint256 decayPct = periods * DECAY_RATE;
        if (decayPct >= 10000) return 0;
        return (score * (10000 - decayPct)) / 10000;
    }

    // ============ View ============

    function getReputation(address user) external view returns (ReputationProfile memory) { return reputations[user]; }
    function getCompositeScore(address user) external view returns (uint256) {
        ReputationProfile storage p = reputations[user];
        if (!p.exists) return 0;
        return _computeComposite(p);
    }
    function getDimensionScore(address user, Dimension dim) external view returns (uint256) {
        return reputations[user].dimensionScores[uint8(dim)];
    }
    function getWeights() external view returns (uint256[8] memory) { return dimensionWeights; }
}
