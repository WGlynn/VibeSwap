// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title ShapleyDistributor
 * @notice Distributes rewards using Shapley value-based fair allocation
 * @dev Implements cooperative game theory for reward distribution where each
 *      economic event (batch settlement, fee distribution) is treated as an
 *      independent cooperative game.
 *
 * Key Principles (from Glynn's Cooperative Reward System):
 * - Distribute only realized value (no inflation)
 * - Reward marginal contribution, not just participation
 * - Recognize enabling contributions (the "glove game")
 * - Event-based games keep computation manageable
 *
 * The Shapley value satisfies:
 * - Efficiency: all value is distributed
 * - Symmetry: equal contributors get equal rewards
 * - Null player: no contribution = no reward
 * - Additivity: consistent across combined games
 */
contract ShapleyDistributor is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS_PRECISION = 10000;

    // Contribution type weights (configurable)
    uint256 public constant DIRECT_WEIGHT = 4000;      // 40% - Direct liquidity provision
    uint256 public constant ENABLING_WEIGHT = 3000;    // 30% - Time-based enabling
    uint256 public constant SCARCITY_WEIGHT = 2000;    // 20% - Providing scarce side
    uint256 public constant STABILITY_WEIGHT = 1000;   // 10% - Staying during volatility

    // ============ Structs ============

    /**
     * @notice Represents a participant in a cooperative game
     * @param participant Address of the participant
     * @param directContribution Raw contribution (e.g., liquidity amount)
     * @param timeInPool Seconds in pool (enabling contribution)
     * @param scarcityScore How much they provided the scarce side (0-10000 bps)
     * @param stabilityScore Did they stay during volatility (0-10000 bps)
     */
    struct Participant {
        address participant;
        uint256 directContribution;
        uint256 timeInPool;
        uint256 scarcityScore;
        uint256 stabilityScore;
    }

    /**
     * @notice Represents a cooperative game (one economic event)
     * @param gameId Unique identifier for this game
     * @param totalValue Total value to distribute
     * @param token Token to distribute (address(0) for ETH)
     * @param participants Array of participants
     * @param settled Whether the game has been settled
     */
    struct CooperativeGame {
        bytes32 gameId;
        uint256 totalValue;
        address token;
        bool settled;
    }

    /**
     * @notice Quality weights for a participant (updated per epoch)
     */
    struct QualityWeight {
        uint256 activityScore;      // Recent activity level
        uint256 reputationScore;    // Long-term behavior
        uint256 economicScore;      // Value contributed historically
        uint64 lastUpdate;
    }

    // ============ State ============

    // Game ID => Game data
    mapping(bytes32 => CooperativeGame) public games;

    // Game ID => Participant index => Participant data
    mapping(bytes32 => Participant[]) public gameParticipants;

    // Game ID => Participant address => Shapley value (computed)
    mapping(bytes32 => mapping(address => uint256)) public shapleyValues;

    // Game ID => Participant address => Claimed
    mapping(bytes32 => mapping(address => bool)) public claimed;

    // Participant => Quality weights
    mapping(address => QualityWeight) public qualityWeights;

    // Authorized game creators (IncentiveController, VibeSwapCore)
    mapping(address => bool) public authorizedCreators;

    // Configuration
    uint256 public minParticipants;
    uint256 public maxParticipants;
    bool public useQualityWeights;

    // ============ Events ============

    event GameCreated(bytes32 indexed gameId, uint256 totalValue, address token, uint256 participantCount);
    event ShapleyComputed(bytes32 indexed gameId, address indexed participant, uint256 shapleyValue);
    event RewardClaimed(bytes32 indexed gameId, address indexed participant, uint256 amount);
    event QualityWeightUpdated(address indexed participant, uint256 activity, uint256 reputation, uint256 economic);

    // ============ Errors ============

    error Unauthorized();
    error GameAlreadyExists();
    error GameNotFound();
    error GameAlreadySettled();
    error GameNotSettled();
    error AlreadyClaimed();
    error NoReward();
    error TooFewParticipants();
    error TooManyParticipants();
    error InvalidValue();
    error ZeroAddress();

    // ============ Modifiers ============

    modifier onlyAuthorized() {
        if (!authorizedCreators[msg.sender] && msg.sender != owner()) {
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
        __ReentrancyGuard_init();

        minParticipants = 2;
        maxParticipants = 100;  // Practical limit for on-chain computation
        useQualityWeights = true;
    }

    // ============ Game Creation ============

    /**
     * @notice Create a new cooperative game for reward distribution
     * @param gameId Unique identifier (e.g., keccak256(batchId, poolId))
     * @param totalValue Total value to distribute
     * @param token Token to distribute (address(0) for ETH)
     * @param participants Array of participants with contribution data
     */
    function createGame(
        bytes32 gameId,
        uint256 totalValue,
        address token,
        Participant[] calldata participants
    ) external onlyAuthorized {
        if (games[gameId].totalValue != 0) revert GameAlreadyExists();
        if (totalValue == 0) revert InvalidValue();
        if (participants.length < minParticipants) revert TooFewParticipants();
        if (participants.length > maxParticipants) revert TooManyParticipants();

        games[gameId] = CooperativeGame({
            gameId: gameId,
            totalValue: totalValue,
            token: token,
            settled: false
        });

        // Store participants
        for (uint256 i = 0; i < participants.length; i++) {
            gameParticipants[gameId].push(participants[i]);
        }

        emit GameCreated(gameId, totalValue, token, participants.length);
    }

    /**
     * @notice Compute Shapley values for all participants in a game
     * @dev Uses weighted contribution model for practical computation
     *      Full Shapley is O(2^n), this approximation is O(n)
     * @param gameId Game identifier
     */
    function computeShapleyValues(bytes32 gameId) external onlyAuthorized {
        CooperativeGame storage game = games[gameId];
        if (game.totalValue == 0) revert GameNotFound();
        if (game.settled) revert GameAlreadySettled();

        Participant[] storage participants = gameParticipants[gameId];
        uint256 n = participants.length;

        // Step 1: Calculate total weighted contributions
        uint256[] memory weightedContributions = new uint256[](n);
        uint256 totalWeightedContribution = 0;

        for (uint256 i = 0; i < n; i++) {
            weightedContributions[i] = _calculateWeightedContribution(participants[i]);
            totalWeightedContribution += weightedContributions[i];
        }

        // Step 2: Distribute value proportional to weighted contribution
        // This is an approximation of Shapley that satisfies efficiency
        uint256 distributed = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 share;
            if (i == n - 1) {
                // Last participant gets remainder (prevents dust)
                share = game.totalValue - distributed;
            } else {
                share = (game.totalValue * weightedContributions[i]) / totalWeightedContribution;
            }

            shapleyValues[gameId][participants[i].participant] = share;
            distributed += share;

            emit ShapleyComputed(gameId, participants[i].participant, share);
        }

        game.settled = true;
    }

    /**
     * @notice Claim reward from a settled game
     * @param gameId Game identifier
     */
    function claimReward(bytes32 gameId) external nonReentrant returns (uint256 amount) {
        CooperativeGame storage game = games[gameId];
        if (game.totalValue == 0) revert GameNotFound();
        if (!game.settled) revert GameNotSettled();
        if (claimed[gameId][msg.sender]) revert AlreadyClaimed();

        amount = shapleyValues[gameId][msg.sender];
        if (amount == 0) revert NoReward();

        claimed[gameId][msg.sender] = true;

        // Transfer reward
        if (game.token == address(0)) {
            (bool success, ) = msg.sender.call{value: amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(game.token).safeTransfer(msg.sender, amount);
        }

        emit RewardClaimed(gameId, msg.sender, amount);
    }

    // ============ Contribution Calculation ============

    /**
     * @notice Calculate weighted contribution for a participant
     * @dev Implements the "glove game" insight: value comes from cooperation
     *
     * Components:
     * - Direct: Raw liquidity/volume provided
     * - Enabling: Time in pool (enabled others to trade)
     * - Scarcity: Provided the scarce side of the market
     * - Stability: Stayed during volatility (enabled survival)
     */
    function _calculateWeightedContribution(
        Participant memory p
    ) internal view returns (uint256) {
        // Normalize each component to PRECISION scale
        uint256 directScore = p.directContribution;

        // Time score: logarithmic scaling (diminishing returns)
        // 1 day = 1x, 7 days = ~1.9x, 30 days = ~2.7x, 365 days = ~4.2x
        uint256 timeScore = _log2Approx(p.timeInPool / 1 days + 1) * PRECISION / 10;

        // Scarcity and stability are already in BPS
        uint256 scarcityNorm = (p.scarcityScore * PRECISION) / BPS_PRECISION;
        uint256 stabilityNorm = (p.stabilityScore * PRECISION) / BPS_PRECISION;

        // Apply quality weights if enabled
        uint256 qualityMultiplier = PRECISION;
        if (useQualityWeights) {
            QualityWeight storage qw = qualityWeights[p.participant];
            if (qw.lastUpdate > 0) {
                // Average of quality scores, scaled to 0.5x - 1.5x multiplier
                uint256 avgQuality = (qw.activityScore + qw.reputationScore + qw.economicScore) / 3;
                qualityMultiplier = (PRECISION / 2) + (avgQuality * PRECISION / BPS_PRECISION);
            }
        }

        // Weighted sum
        uint256 weighted = (
            (directScore * DIRECT_WEIGHT) +
            (timeScore * ENABLING_WEIGHT) +
            (scarcityNorm * SCARCITY_WEIGHT) +
            (stabilityNorm * STABILITY_WEIGHT)
        ) / BPS_PRECISION;

        return (weighted * qualityMultiplier) / PRECISION;
    }

    /**
     * @notice Approximate log2 for time-based scoring
     * @dev Simple approximation: count bits
     */
    function _log2Approx(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 result = 0;
        while (x > 1) {
            x >>= 1;
            result++;
        }
        return result;
    }

    // ============ Scarcity Calculation ============

    /**
     * @notice Calculate scarcity score for batch participants
     * @dev The "glove game": if batch is buy-heavy, sell-side LPs are scarce
     * @param buyVolume Total buy volume in batch
     * @param sellVolume Total sell volume in batch
     * @param participantSide true = buy side, false = sell side
     * @param participantVolume Participant's volume
     * @return scarcityScore Score in BPS (0-10000)
     */
    function calculateScarcityScore(
        uint256 buyVolume,
        uint256 sellVolume,
        bool participantSide,
        uint256 participantVolume
    ) external pure returns (uint256 scarcityScore) {
        if (buyVolume == 0 && sellVolume == 0) return 5000; // Neutral

        uint256 totalVolume = buyVolume + sellVolume;
        uint256 buyRatio = (buyVolume * BPS_PRECISION) / totalVolume;

        // If buy-heavy (buyRatio > 50%), sell side is scarce
        // If sell-heavy (buyRatio < 50%), buy side is scarce
        bool scarceIsSell = buyRatio > 5000;

        if (participantSide == scarceIsSell) {
            // Participant is on the abundant side
            // Score decreases as imbalance increases
            uint256 imbalance = scarceIsSell ? buyRatio - 5000 : 5000 - buyRatio;
            scarcityScore = 5000 - (imbalance / 2); // 2500 - 5000 range
        } else {
            // Participant is on the scarce side
            // Score increases as imbalance increases
            uint256 imbalance = scarceIsSell ? buyRatio - 5000 : 5000 - buyRatio;
            scarcityScore = 5000 + (imbalance / 2); // 5000 - 7500 range
        }

        // Bonus for larger contribution to scarce side
        if (!participantSide == scarceIsSell) {
            uint256 scarceSideVolume = scarceIsSell ? sellVolume : buyVolume;
            if (scarceSideVolume > 0) {
                uint256 shareOfScarce = (participantVolume * BPS_PRECISION) / scarceSideVolume;
                scarcityScore += shareOfScarce / 10; // Up to +1000 for 100% of scarce side
            }
        }

        // Cap at 10000
        if (scarcityScore > BPS_PRECISION) {
            scarcityScore = BPS_PRECISION;
        }
    }

    // ============ Quality Weight Management ============

    /**
     * @notice Update quality weights for a participant (called per epoch)
     * @param participant Participant address
     * @param activityScore Recent activity (0-10000 bps)
     * @param reputationScore Long-term reputation (0-10000 bps)
     * @param economicScore Economic contribution (0-10000 bps)
     */
    function updateQualityWeight(
        address participant,
        uint256 activityScore,
        uint256 reputationScore,
        uint256 economicScore
    ) external onlyAuthorized {
        // Validate scores are within bounds (0-10000 bps)
        require(activityScore <= BPS_PRECISION, "Activity score exceeds max");
        require(reputationScore <= BPS_PRECISION, "Reputation score exceeds max");
        require(economicScore <= BPS_PRECISION, "Economic score exceeds max");

        qualityWeights[participant] = QualityWeight({
            activityScore: activityScore,
            reputationScore: reputationScore,
            economicScore: economicScore,
            lastUpdate: uint64(block.timestamp)
        });

        emit QualityWeightUpdated(participant, activityScore, reputationScore, economicScore);
    }

    // ============ View Functions ============

    /**
     * @notice Get Shapley value for a participant in a game
     */
    function getShapleyValue(bytes32 gameId, address participant) external view returns (uint256) {
        return shapleyValues[gameId][participant];
    }

    /**
     * @notice Get all participants in a game
     */
    function getGameParticipants(bytes32 gameId) external view returns (Participant[] memory) {
        return gameParticipants[gameId];
    }

    /**
     * @notice Check if a game is settled
     */
    function isGameSettled(bytes32 gameId) external view returns (bool) {
        return games[gameId].settled;
    }

    /**
     * @notice Get pending reward for a participant
     */
    function getPendingReward(bytes32 gameId, address participant) external view returns (uint256) {
        if (!games[gameId].settled) return 0;
        if (claimed[gameId][participant]) return 0;
        return shapleyValues[gameId][participant];
    }

    // ============ Admin Functions ============

    function setAuthorizedCreator(address creator, bool authorized) external onlyOwner {
        authorizedCreators[creator] = authorized;
    }

    function setParticipantLimits(uint256 _min, uint256 _max) external onlyOwner {
        minParticipants = _min;
        maxParticipants = _max;
    }

    function setUseQualityWeights(bool _use) external onlyOwner {
        useQualityWeights = _use;
    }

    // ============ Receive ETH ============

    receive() external payable {}

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
