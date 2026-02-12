// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../libraries/PairwiseFairness.sol";

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
 * The Shapley value satisfies five axioms:
 * - Efficiency: all value is distributed
 * - Symmetry: equal contributors get equal rewards
 * - Null player: no contribution = no reward
 * - Pairwise Proportionality: reward ratio = contribution ratio for any pair
 * - Time Neutrality: identical contributions yield identical rewards regardless of when
 *
 * Two-Track Distribution:
 *
 * Track 1 — FEE_DISTRIBUTION (Time-Neutral):
 * - Trading fees distributed via pure proportional Shapley
 * - NO halving applied — same work earns same reward regardless of era
 * - Satisfies all five axioms including Time Neutrality
 *
 * Track 2 — TOKEN_EMISSION (Scheduled):
 * - Protocol token emissions follow Bitcoin-style halving schedule
 * - Halving occurs every era (configurable, default ~1 year equivalent)
 * - Intentionally NOT time-neutral (bootstrapping incentive, like Bitcoin block rewards)
 *
 * See: docs/TIME_NEUTRAL_TOKENOMICS.md for formal proofs
 */
contract ShapleyDistributor is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Custom Errors (Gas Optimized) ============

    error ETHTransferFailed();
    error ScoreExceedsMax();
    error InvalidGamesPerEra();

    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS_PRECISION = 10000;

    // Contribution type weights (configurable)
    uint256 public constant DIRECT_WEIGHT = 4000;      // 40% - Direct liquidity provision
    uint256 public constant ENABLING_WEIGHT = 3000;    // 30% - Time-based enabling
    uint256 public constant SCARCITY_WEIGHT = 2000;    // 20% - Providing scarce side
    uint256 public constant STABILITY_WEIGHT = 1000;   // 10% - Staying during volatility

    // ============ Bitcoin Halving Schedule Constants ============

    /// @notice Number of games per halving era (like Bitcoin's 210,000 blocks)
    /// @dev Default: 52,560 games ≈ 1 year at 1 game per 10 minutes
    uint256 public constant DEFAULT_GAMES_PER_ERA = 52560;

    /// @notice Maximum number of halving eras (32 halvings = rewards approach 0)
    uint8 public constant MAX_HALVING_ERAS = 32;

    /// @notice Initial emission multiplier (100% = PRECISION)
    uint256 public constant INITIAL_EMISSION = PRECISION;

    // ============ Enums ============

    /**
     * @notice Type of cooperative game — determines halving behavior
     * @dev FEE_DISTRIBUTION: Time-neutral. Pure Shapley, no halving. Same work = same reward.
     *      TOKEN_EMISSION: Halving applies. Like Bitcoin block rewards — bootstrapping incentive.
     *
     * See: docs/TIME_NEUTRAL_TOKENOMICS.md §4.1 "Two-Track Distribution"
     */
    enum GameType {
        FEE_DISTRIBUTION,   // Time-neutral: no halving, pure proportional Shapley
        TOKEN_EMISSION      // Scheduled: halving applies (like Bitcoin block rewards)
    }

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
     * @param gameType FEE_DISTRIBUTION (time-neutral) or TOKEN_EMISSION (halving)
     * @param settled Whether the game has been settled
     */
    struct CooperativeGame {
        bytes32 gameId;
        uint256 totalValue;
        address token;
        GameType gameType;
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

    // Game ID => Participant address => Weighted contribution (stored for pairwise verification)
    mapping(bytes32 => mapping(address => uint256)) public weightedContributions;

    // Game ID => Total weighted contribution (stored for pairwise verification tolerance)
    mapping(bytes32 => uint256) public totalWeightedContrib;

    // Participant => Quality weights
    mapping(address => QualityWeight) public qualityWeights;

    // Authorized game creators (IncentiveController, VibeSwapCore)
    mapping(address => bool) public authorizedCreators;

    // Configuration
    uint256 public minParticipants;
    uint256 public maxParticipants;
    bool public useQualityWeights;

    // ============ Bitcoin Halving State ============

    /// @notice Genesis timestamp (when halving schedule started)
    uint256 public genesisTimestamp;

    /// @notice Total games created (used for era calculation)
    uint256 public totalGamesCreated;

    /// @notice Games per era (configurable, default DEFAULT_GAMES_PER_ERA)
    uint256 public gamesPerEra;

    /// @notice Whether halving schedule is enabled
    bool public halvingEnabled;

    /// @notice Total value distributed across all eras (for tracking)
    uint256 public totalValueDistributed;

    /// @notice Value distributed per era
    mapping(uint8 => uint256) public eraDistributed;

    // ============ Events ============

    event GameCreated(bytes32 indexed gameId, uint256 totalValue, address token, uint256 participantCount);
    event ShapleyComputed(bytes32 indexed gameId, address indexed participant, uint256 shapleyValue);
    event RewardClaimed(bytes32 indexed gameId, address indexed participant, uint256 amount);
    event QualityWeightUpdated(address indexed participant, uint256 activity, uint256 reputation, uint256 economic);
    event HalvingEraChanged(uint8 indexed newEra, uint256 emissionMultiplier, uint256 totalGames);
    event HalvingApplied(bytes32 indexed gameId, uint256 originalValue, uint256 adjustedValue, uint8 era);
    event FairnessVerified(bytes32 indexed gameId, address indexed participant1, address indexed participant2, bool fair, uint256 deviation);

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

        // Initialize Bitcoin halving schedule
        genesisTimestamp = block.timestamp;
        gamesPerEra = DEFAULT_GAMES_PER_ERA;
        halvingEnabled = true;
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
        // Default to FEE_DISTRIBUTION (time-neutral)
        _createGameInternal(gameId, totalValue, token, GameType.FEE_DISTRIBUTION, participants);
    }

    /**
     * @notice Create a game with explicit type (fee distribution or token emission)
     * @dev FEE_DISTRIBUTION: Time-neutral, no halving. Same work = same reward.
     *      TOKEN_EMISSION: Halving applies. Like Bitcoin block rewards.
     * @param gameId Unique identifier
     * @param totalValue Total value to distribute
     * @param token Token to distribute (address(0) for ETH)
     * @param gameType FEE_DISTRIBUTION or TOKEN_EMISSION
     * @param participants Array of participants with contribution data
     */
    function createGameTyped(
        bytes32 gameId,
        uint256 totalValue,
        address token,
        GameType gameType,
        Participant[] calldata participants
    ) external onlyAuthorized {
        _createGameInternal(gameId, totalValue, token, gameType, participants);
    }

    function _createGameInternal(
        bytes32 gameId,
        uint256 totalValue,
        address token,
        GameType gameType,
        Participant[] calldata participants
    ) internal {
        if (games[gameId].totalValue != 0) revert GameAlreadyExists();
        if (totalValue == 0) revert InvalidValue();
        if (participants.length < minParticipants) revert TooFewParticipants();
        if (participants.length > maxParticipants) revert TooManyParticipants();

        // Apply halving ONLY for TOKEN_EMISSION games (not fee distribution)
        // Fee distribution is time-neutral: same work = same reward regardless of era
        // See: docs/TIME_NEUTRAL_TOKENOMICS.md §4.1
        uint256 adjustedValue = totalValue;
        uint8 currentEra = getCurrentHalvingEra();

        if (gameType == GameType.TOKEN_EMISSION && halvingEnabled && currentEra > 0) {
            uint256 emissionMultiplier = getEmissionMultiplier(currentEra);
            adjustedValue = (totalValue * emissionMultiplier) / PRECISION;

            emit HalvingApplied(gameId, totalValue, adjustedValue, currentEra);
        }

        games[gameId] = CooperativeGame({
            gameId: gameId,
            totalValue: adjustedValue,
            token: token,
            gameType: gameType,
            settled: false
        });

        // Store participants
        for (uint256 i = 0; i < participants.length; i++) {
            gameParticipants[gameId].push(participants[i]);
        }

        // Update halving tracking
        uint8 prevEra = totalGamesCreated > 0 ? uint8((totalGamesCreated - 1) / gamesPerEra) : 0;
        totalGamesCreated++;

        // Check if we crossed into a new era
        if (currentEra > prevEra && currentEra <= MAX_HALVING_ERAS) {
            emit HalvingEraChanged(currentEra, getEmissionMultiplier(currentEra), totalGamesCreated);
        }

        emit GameCreated(gameId, adjustedValue, token, participants.length);
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
        uint256[] memory weights = new uint256[](n);
        uint256 totalWeight = 0;

        for (uint256 i = 0; i < n; i++) {
            weights[i] = _calculateWeightedContribution(participants[i]);
            totalWeight += weights[i];

            // Store for pairwise verification (anyone can audit fairness on-chain)
            weightedContributions[gameId][participants[i].participant] = weights[i];
        }

        // Store total weight for pairwise verification tolerance
        totalWeightedContrib[gameId] = totalWeight;

        // Step 2: Distribute value proportional to weighted contribution
        // This satisfies Efficiency, Pairwise Proportionality, and Time Neutrality
        // See: docs/TIME_NEUTRAL_TOKENOMICS.md §3.1-3.3
        uint256 distributed = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 share;
            if (i == n - 1) {
                // Last participant gets remainder (prevents dust)
                share = game.totalValue - distributed;
            } else {
                share = (game.totalValue * weights[i]) / totalWeight;
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
            if (!success) revert ETHTransferFailed();
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
        if (activityScore > BPS_PRECISION || reputationScore > BPS_PRECISION || economicScore > BPS_PRECISION) {
            revert ScoreExceedsMax();
        }

        qualityWeights[participant] = QualityWeight({
            activityScore: activityScore,
            reputationScore: reputationScore,
            economicScore: economicScore,
            lastUpdate: uint64(block.timestamp)
        });

        emit QualityWeightUpdated(participant, activityScore, reputationScore, economicScore);
    }

    // ============ Bitcoin Halving Functions ============

    /**
     * @notice Get the current halving era based on games created
     * @dev Era 0 = first gamesPerEra games, Era 1 = next gamesPerEra, etc.
     * @return Current era (0 to MAX_HALVING_ERAS)
     */
    function getCurrentHalvingEra() public view returns (uint8) {
        if (gamesPerEra == 0) return 0;

        uint256 era = totalGamesCreated / gamesPerEra;

        // Cap at MAX_HALVING_ERAS
        if (era > MAX_HALVING_ERAS) {
            return MAX_HALVING_ERAS;
        }

        return uint8(era);
    }

    /**
     * @notice Get emission multiplier for a given era
     * @dev Era 0 = 100% (PRECISION), Era 1 = 50%, Era 2 = 25%, etc.
     *      Uses bit shifting for gas-efficient halving: PRECISION >> era
     * @param era The halving era (0 to MAX_HALVING_ERAS)
     * @return Emission multiplier (scaled by PRECISION)
     */
    function getEmissionMultiplier(uint8 era) public pure returns (uint256) {
        if (era == 0) return INITIAL_EMISSION;
        if (era >= MAX_HALVING_ERAS) return 0; // After 32 halvings, essentially 0

        // Halving: PRECISION / 2^era = PRECISION >> era
        return INITIAL_EMISSION >> era;
    }

    /**
     * @notice Get remaining games until next halving
     * @return Games remaining until next era
     */
    function gamesUntilNextHalving() external view returns (uint256) {
        if (gamesPerEra == 0) return type(uint256).max;

        uint8 currentEra = getCurrentHalvingEra();
        if (currentEra >= MAX_HALVING_ERAS) return 0;

        uint256 nextEraStartGame = (uint256(currentEra) + 1) * gamesPerEra;
        if (totalGamesCreated >= nextEraStartGame) return 0;

        return nextEraStartGame - totalGamesCreated;
    }

    /**
     * @notice Get halving schedule info
     * @return currentEra Current halving era
     * @return currentMultiplier Current emission multiplier (PRECISION scale)
     * @return currentMultiplierBps Current emission as basis points (10000 = 100%)
     * @return gamesInCurrentEra Games created in current era
     * @return totalGames Total games created ever
     */
    function getHalvingInfo() external view returns (
        uint8 currentEra,
        uint256 currentMultiplier,
        uint256 currentMultiplierBps,
        uint256 gamesInCurrentEra,
        uint256 totalGames
    ) {
        currentEra = getCurrentHalvingEra();
        currentMultiplier = getEmissionMultiplier(currentEra);
        currentMultiplierBps = (currentMultiplier * BPS_PRECISION) / PRECISION;
        gamesInCurrentEra = gamesPerEra > 0 ? totalGamesCreated % gamesPerEra : 0;
        totalGames = totalGamesCreated;
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

    // ============ Fairness Verification (Public — anyone can audit) ============

    /**
     * @notice Verify pairwise proportionality between two participants in a game
     * @dev Checks: reward_A / reward_B ≈ weight_A / weight_B
     *      Uses cross-multiplication to avoid division: |φA×wB - φB×wA| ≤ ε
     *      See: docs/TIME_NEUTRAL_TOKENOMICS.md §3.2
     * @param gameId Game identifier
     * @param participant1 First participant address
     * @param participant2 Second participant address
     * @return fair True if pairwise proportionality holds within rounding tolerance
     * @return deviation Absolute deviation from perfect proportionality
     */
    function verifyPairwiseFairness(
        bytes32 gameId,
        address participant1,
        address participant2
    ) external view returns (bool fair, uint256 deviation) {
        // Tolerance: cross-multiplication produces values on order of reward × weight.
        // Integer division rounding error in reward ≈ totalWeight, so
        // deviation = |rewardA×wB - rewardB×wA| can be up to max(wA,wB) ≤ totalWeight.
        uint256 tolerance = totalWeightedContrib[gameId];

        PairwiseFairness.FairnessResult memory result = PairwiseFairness.verifyPairwiseProportionality(
            shapleyValues[gameId][participant1],
            shapleyValues[gameId][participant2],
            weightedContributions[gameId][participant1],
            weightedContributions[gameId][participant2],
            tolerance
        );

        return (result.fair, result.deviation);
    }

    /**
     * @notice Verify time neutrality across two games for a participant
     * @dev For FEE_DISTRIBUTION games with identical contributions and total values,
     *      rewards must be equal. See: docs/TIME_NEUTRAL_TOKENOMICS.md §3.3
     * @param gameId1 First game identifier
     * @param gameId2 Second game identifier
     * @param participant Participant address (must be in both games)
     * @return neutral True if allocations are equal within tolerance
     * @return deviation Absolute difference between the two allocations
     */
    function verifyTimeNeutrality(
        bytes32 gameId1,
        bytes32 gameId2,
        address participant
    ) external view returns (bool neutral, uint256 deviation) {
        // Both games must be fee distribution (time-neutral track)
        require(
            games[gameId1].gameType == GameType.FEE_DISTRIBUTION &&
            games[gameId2].gameType == GameType.FEE_DISTRIBUTION,
            "Time neutrality only applies to FEE_DISTRIBUTION games"
        );

        uint256 reward1 = shapleyValues[gameId1][participant];
        uint256 reward2 = shapleyValues[gameId2][participant];

        // Tolerance: max of both games' participant counts
        uint256 tolerance = gameParticipants[gameId1].length > gameParticipants[gameId2].length
            ? gameParticipants[gameId1].length
            : gameParticipants[gameId2].length;

        PairwiseFairness.FairnessResult memory result = PairwiseFairness.verifyTimeNeutrality(
            reward1,
            reward2,
            tolerance
        );

        return (result.fair, result.deviation);
    }

    /**
     * @notice Get the weighted contribution stored for a participant in a game
     * @dev Stored during computeShapleyValues for post-hoc fairness verification
     */
    function getWeightedContribution(bytes32 gameId, address participant) external view returns (uint256) {
        return weightedContributions[gameId][participant];
    }

    /**
     * @notice Get the game type (FEE_DISTRIBUTION or TOKEN_EMISSION)
     */
    function getGameType(bytes32 gameId) external view returns (GameType) {
        return games[gameId].gameType;
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

    // ============ Halving Admin Functions ============

    /**
     * @notice Enable or disable halving schedule
     * @param _enabled Whether halving should be applied
     */
    function setHalvingEnabled(bool _enabled) external onlyOwner {
        halvingEnabled = _enabled;
    }

    /**
     * @notice Set games per halving era
     * @dev Only affects future era calculations, not past games
     * @param _gamesPerEra New games per era value
     */
    function setGamesPerEra(uint256 _gamesPerEra) external onlyOwner {
        if (_gamesPerEra == 0) revert InvalidGamesPerEra();
        gamesPerEra = _gamesPerEra;
    }

    /**
     * @notice Emergency reset of genesis timestamp (use with caution)
     * @dev Only for correcting deployment issues, not regular use
     */
    function resetGenesisTimestamp() external onlyOwner {
        genesisTimestamp = block.timestamp;
    }

    // ============ Receive ETH ============

    receive() external payable {}

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
