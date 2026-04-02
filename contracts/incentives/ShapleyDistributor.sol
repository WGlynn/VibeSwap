// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../libraries/PairwiseFairness.sol";
import "./IPriorityRegistry.sol";
import "../mechanism/IABCHealthCheck.sol";
import "../settlement/IShapleyVerifier.sol";
import "./ISybilGuard.sol";

/**
 * @title ShapleyDistributor
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Distributes rewards using Shapley value-based fair allocation
 * @dev Implements cooperative game theory for reward distribution where each
 *      economic event (batch settlement, fee distribution) is treated as an
 *      independent cooperative game. P-000: Fairness Above All.
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

    // ============ DISINTERMEDIATION ROADMAP ============
    // Phase 1 (NOW): Owner controls all admin functions
    // Phase 2 (NEXT): Transfer ownership to TimelockController (48h delay)
    // Phase 3 (GOVERNANCE): DAO proposals via GovernanceGuard with Shapley veto
    // Phase 4 (GHOST): Renounce ownership. Immutable where safe. Governance where needed.
    // Every onlyOwner function in this contract has a documented target grade.
    //
    // Disintermediation Grades:
    //   Grade A (DISSOLVED): No access control. Permissionless. Structurally safe.
    //   Grade B (GOVERNANCE): TimelockController + DAO vote. No single human can act.
    //   Grade C (OWNER): Current state. Single owner key. Bootstrap-only.
    //   KEEP: Genuinely security-critical. Remains gated even in Phase 4.

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

    // TRP-R19-K02: Pioneer bonus constant is UNUSED — actual cap is 2.0x (100% bonus)
    // in _calculateWeightedContribution lines 788-795, not 1.5x as previously documented.
    // Kept for storage/ABI compatibility. Do not rely on this value.
    // Actual behavior: pioneerScore capped at 2*BPS_PRECISION, multiplier range [1.0x, 2.0x]
    uint256 public constant PIONEER_BONUS_MAX_BPS = 5000;

    /// @notice The Lawson Fairness Floor — minimum reward share (1%) for any
    ///         participant who contributed to a cooperative game, ensuring nobody
    ///         who showed up and acted honestly walks away with zero.
    ///         Named after Jayme Lawson, whose embodiment of cooperative fairness
    ///         and community-first ethos inspired VibeSwap's design philosophy.
    uint256 public constant LAWSON_FAIRNESS_FLOOR = 100; // 1% in BPS

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

    // ============ Pioneer Priority State ============

    /// @notice Optional PriorityRegistry for first-to-publish bonus (address(0) = disabled)
    IPriorityRegistry public priorityRegistry;

    /// @notice Game ID => scope ID (typically poolId) for pioneer lookup
    mapping(bytes32 => bytes32) public gameScopeId;

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

    /// @notice Total value committed but not yet claimed, tracked per token
    /// @dev TRP-R19-F08: Changed from single uint256 to per-token mapping. A single
    ///      counter across all token types conflated ETH (18 decimals) with ERC20s
    ///      (varying decimals), making multi-token game creation impossible.
    ///      Use address(0) key for ETH, token address for ERC20s.
    mapping(address => uint256) public totalCommittedBalance;

    /// @notice Value distributed per era
    mapping(uint8 => uint256) public eraDistributed;

    // ============ ABC Conservation Gate (Immutable Once Sealed) ============

    /// @notice Augmented Bonding Curve health checker — gates reward distribution
    /// @dev Once sealed via sealBondingCurve(), this cannot be changed. Ever.
    ///      Rewards only flow when the curve's conservation invariant is healthy.
    ///      This is the augmented mechanism design: Shapley math + ABC physics.
    IABCHealthCheck public bondingCurve;

    /// @notice Whether the bonding curve has been sealed (immutable after sealing)
    bool public bondingCurveSealed;

    // ============ Sybil Guard (Lawson Floor Protection) ============

    /// @notice Optional sybil guard — prevents Lawson Floor exploitation
    /// @dev When set, participants without verified identity are excluded from
    ///      the Lawson Floor minimum. They still get proportional Shapley rewards,
    ///      but can't exploit the 1% minimum by splitting into many accounts.
    ///      Found by adversarial search: 200/200 rounds showed profitable sybil splitting.
    ISybilGuard public sybilGuard;

    // ============ ShapleyVerifier Integration (Settlement Layer) ============

    /// @notice Off-chain Shapley verifier — accepts pre-verified results
    /// @dev When set, settleFromVerifier() can pull finalized Shapley values
    ///      instead of computing on-chain. Execution/settlement separation.
    IShapleyVerifier public shapleyVerifier;

    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event BondingCurveSealed(address indexed bondingCurve);
    event ABCHealthGate(bytes32 indexed gameId, bool healthy, uint256 driftBps);
    event GameCreated(bytes32 indexed gameId, uint256 totalValue, address token, uint256 participantCount);
    event ShapleyComputed(bytes32 indexed gameId, address indexed participant, uint256 shapleyValue);
    event RewardClaimed(bytes32 indexed gameId, address indexed participant, uint256 amount);
    event QualityWeightUpdated(address indexed participant, uint256 activity, uint256 reputation, uint256 economic);
    event HalvingEraChanged(uint8 indexed newEra, uint256 emissionMultiplier, uint256 totalGames);
    event HalvingApplied(bytes32 indexed gameId, uint256 originalValue, uint256 adjustedValue, uint8 era);
    event FairnessVerified(bytes32 indexed gameId, address indexed participant1, address indexed participant2, bool fair, uint256 deviation);
    event SettledFromVerifier(bytes32 indexed gameId, uint256 participantCount, uint256 totalPool);
    event ShapleyVerifierUpdated(address indexed verifier);
    event AuthorizedCreatorUpdated(address indexed creator, bool authorized);
    event ParticipantLimitsUpdated(uint256 minParticipants, uint256 maxParticipants);
    event QualityWeightsToggled(bool enabled);
    event PriorityRegistryUpdated(address indexed registry);
    event HalvingToggled(bool enabled);
    event GamesPerEraUpdated(uint256 gamesPerEra);
    event GenesisTimestampReset(uint256 newTimestamp);
    event SybilGuardUpdated(address indexed guard);

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
    error ABCUnhealthy(uint256 driftBps);
    error BondingCurveAlreadySealed();
    error VerifierNotSet();
    error VerifierResultNotFinalized();
    error VerifierParticipantMismatch();

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

    // ============ ABC Conservation Seal (Set Once, Immutable Forever) ============

    /**
     * @notice Seal the bonding curve reference — IRREVERSIBLE.
     * @dev Once sealed, the ABC health gate is permanently enforced on all
     *      reward distributions. The bonding curve address cannot be changed,
     *      the gate cannot be bypassed, and no admin can override it.
     *
     *      This is the "augmented" in augmented mechanism design:
     *      - Shapley handles the math (who gets what proportion)
     *      - ABC handles the physics (is the economy conserving energy?)
     *      - Together they make rewards fair AND stable
     *
     *      The Lawson Constant lives in both contracts. After sealing,
     *      they are cryptographically bound — one cannot distribute
     *      without the other's conservation invariant holding.
     *
     * @param _bondingCurve Address of the AugmentedBondingCurve contract
     */
    /// DISINTERMEDIATION: KEEP — sealing is a one-way operation that permanently
    /// binds the ABC health gate. Must be owner-gated to prevent griefing (sealing
    /// with a malicious contract). After sealing, this function is dead code anyway.
    function sealBondingCurve(address _bondingCurve) external onlyOwner {
        if (bondingCurveSealed) revert BondingCurveAlreadySealed();
        if (_bondingCurve == address(0)) revert ZeroAddress();

        // Verify it implements the interface and is actually open
        IABCHealthCheck abc = IABCHealthCheck(_bondingCurve);
        require(abc.isOpen(), "ABC not open");

        bondingCurve = abc;
        bondingCurveSealed = true;

        emit BondingCurveSealed(_bondingCurve);
    }

    /**
     * @notice Internal ABC health gate — reverts if curve is under stress
     * @dev Called before game creation and settlement. If bondingCurve is not
     *      sealed yet (pre-deployment bootstrapping), this is a no-op.
     *      Once sealed, it becomes an immutable checkpoint.
     */
    function _requireABCHealthy(bytes32 gameId) internal {
        if (!bondingCurveSealed) return; // Pre-seal bootstrapping: no gate

        (bool healthy, uint256 driftBps) = bondingCurve.isHealthy();
        emit ABCHealthGate(gameId, healthy, driftBps);

        if (!healthy) revert ABCUnhealthy(driftBps);
    }

    // ============ Game Creation ============

    /**
     * @notice Create a new cooperative game for reward distribution
     * @param gameId Unique identifier (e.g., keccak256(batchId, poolId))
     * @param totalValue Total value to distribute
     * @param token Token to distribute (address(0) for ETH)
     * @param participants Array of participants with contribution data
     *
     * DISINTERMEDIATION: KEEP (Phase 2) — the caller defines participants and weights,
     * which is a trust-critical operation. If permissionless, anyone could create games
     * with fabricated contributions to drain funds.
     * Target: on-chain contribution tracking (ContributionDAG + IncentiveController)
     * auto-creates games from verified on-chain state. No human picks participants.
     * Path: createGame becomes internal, called only by verified on-chain event hooks.
     */
    function createGame(
        bytes32 gameId,
        uint256 totalValue,
        address token,
        Participant[] calldata participants
    ) external onlyAuthorized {
        // Default to FEE_DISTRIBUTION (time-neutral), no scope
        _createGameInternal(gameId, totalValue, token, GameType.FEE_DISTRIBUTION, bytes32(0), participants);
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
     *
     * DISINTERMEDIATION: KEEP — same as createGame(). Caller defines participants.
     * Target: auto-creation from on-chain contribution tracking.
     */
    function createGameTyped(
        bytes32 gameId,
        uint256 totalValue,
        address token,
        GameType gameType,
        Participant[] calldata participants
    ) external onlyAuthorized {
        _createGameInternal(gameId, totalValue, token, gameType, bytes32(0), participants);
    }

    /**
     * @notice Create a game with explicit type AND scope for pioneer lookup
     * @dev When scopeId is set and priorityRegistry is configured, participants who are
     *      pioneers for that scope receive a bonus multiplier on their weighted contribution.
     * @param gameId Unique identifier
     * @param totalValue Total value to distribute
     * @param token Token to distribute (address(0) for ETH)
     * @param gameType FEE_DISTRIBUTION or TOKEN_EMISSION
     * @param scopeId Scope identifier (typically poolId) for pioneer lookup
     * @param participants Array of participants with contribution data
     *
     * DISINTERMEDIATION: KEEP — same as createGame(). Caller defines participants.
     * Target: auto-creation from on-chain contribution tracking.
     */
    function createGameFull(
        bytes32 gameId,
        uint256 totalValue,
        address token,
        GameType gameType,
        bytes32 scopeId,
        Participant[] calldata participants
    ) external onlyAuthorized {
        _createGameInternal(gameId, totalValue, token, gameType, scopeId, participants);
    }

    function _createGameInternal(
        bytes32 gameId,
        uint256 totalValue,
        address token,
        GameType gameType,
        bytes32 scopeId,
        Participant[] calldata participants
    ) internal {
        if (games[gameId].totalValue != 0) revert GameAlreadyExists();
        if (totalValue == 0) revert InvalidValue();
        if (participants.length < minParticipants) revert TooFewParticipants();
        if (participants.length > maxParticipants) revert TooManyParticipants();

        // Validate participant inputs: no duplicates, bounded scores
        for (uint256 i = 0; i < participants.length; i++) {
            require(participants[i].participant != address(0), "Zero address participant");
            require(participants[i].scarcityScore <= BPS_PRECISION, "Scarcity score exceeds 10000");
            require(participants[i].stabilityScore <= BPS_PRECISION, "Stability score exceeds 10000");

            // Check for duplicate participants (O(n^2) but n <= maxParticipants which is bounded)
            for (uint256 j = 0; j < i; j++) {
                require(participants[i].participant != participants[j].participant, "Duplicate participant");
            }
        }

        // ABC Conservation Gate: no games created when curve is under stress
        _requireABCHealthy(gameId);

        // H-03 DISSOLVED: Verify contract holds enough tokens to cover the game
        // INCLUDING already-committed funds from other unsettled games.
        // Prevents concurrent game creation from overdrawing shared balance.
        if (token == address(0)) {
            require(address(this).balance >= totalCommittedBalance[address(0)] + totalValue, "Insufficient ETH for game");
        } else {
            require(IERC20(token).balanceOf(address(this)) >= totalCommittedBalance[token] + totalValue, "Insufficient tokens for game");
        }

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

        // TRP-R19-F02: Commit adjustedValue (post-halving), not totalValue.
        // Previous code committed totalValue then set game.totalValue = adjustedValue,
        // creating phantom committed balance that permanently locked funds.
        totalCommittedBalance[token] += adjustedValue;

        games[gameId] = CooperativeGame({
            gameId: gameId,
            totalValue: adjustedValue,
            token: token,
            gameType: gameType,
            settled: false
        });

        // Store scope for pioneer lookup
        if (scopeId != bytes32(0)) {
            gameScopeId[gameId] = scopeId;
        }

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
     *
     *      DISINTERMEDIATION: DISSOLVED (Phase 2). This is pure math — deterministic
     *      given the participants and weights stored on-chain. There is no reason only
     *      authorized creators should compute it. Anyone can settle a game that's been
     *      created. The inputs are immutable (stored in gameParticipants), the output
     *      is deterministic, and the ABC health gate provides the safety check.
     *      Permissionless settlement means games can never be held hostage.
     *
     * @param gameId Game identifier
     */
    function computeShapleyValues(bytes32 gameId) external {
        CooperativeGame storage game = games[gameId];
        if (game.totalValue == 0) revert GameNotFound();
        if (game.settled) revert GameAlreadySettled();

        // ABC Conservation Gate: no settlement when curve is under stress
        _requireABCHealthy(gameId);

        // Step 1+2: Compute weights and proportional shares (scoped to free stack)
        Participant[] storage participants = gameParticipants[gameId];
        uint256 n = participants.length;
        uint256[] memory shares;
        uint256[] memory weights;
        {
            weights = new uint256[](n);
            uint256 totalWeight = 0;
            for (uint256 i = 0; i < n; i++) {
                weights[i] = _calculateWeightedContribution(participants[i], gameId);
                totalWeight += weights[i];
                weightedContributions[gameId][participants[i].participant] = weights[i];
            }
            if (totalWeight == 0) revert GameNotFound();
            totalWeightedContrib[gameId] = totalWeight;

            shares = new uint256[](n);
            for (uint256 i = 0; i < n; i++) {
                shares[i] = (game.totalValue * weights[i]) / totalWeight;
            }
        }

        // Step 3: Enforce Lawson Fairness Floor + Step 4: Force efficiency
        _applyFloorAndEfficiency(game.totalValue, participants, weights, shares);

        // Final assignment
        for (uint256 i = 0; i < n; i++) {
            shapleyValues[gameId][participants[i].participant] = shares[i];
            emit ShapleyComputed(gameId, participants[i].participant, shares[i]);
        }

        game.settled = true;
    }

    /// @dev Steps 3-4 of computeShapleyValues: Lawson floor enforcement + dust efficiency.
    /// Extracted to reduce stack depth in the parent function.
    function _applyFloorAndEfficiency(
        uint256 totalValue,
        Participant[] storage participants,
        uint256[] memory weights,
        uint256[] memory shares
    ) internal {
        uint256 n = shares.length;
        uint256 floorAmount = (totalValue * LAWSON_FAIRNESS_FLOOR) / BPS_PRECISION;

        // Step 3: Enforce Lawson Fairness Floor (1% minimum for non-zero contributors)
        // Named after Jayme Lawson — nobody who showed up and acted honestly walks away empty.
        // SYBIL GUARD: only verified identities get the floor boost when guard is active.
        {
            uint256 floorDeficit = 0;
            uint256 nonFloorWeight = 0;
            bool hasSybilGuard = address(sybilGuard) != address(0);

            for (uint256 i = 0; i < n; i++) {
                bool eligibleForFloor = weights[i] > 0 && shares[i] < floorAmount;
                if (hasSybilGuard && eligibleForFloor) {
                    eligibleForFloor = sybilGuard.isUniqueIdentity(participants[i].participant);
                }
                if (eligibleForFloor) {
                    floorDeficit += floorAmount - shares[i];
                    shares[i] = floorAmount;
                } else if (shares[i] > floorAmount) {
                    nonFloorWeight += weights[i];
                }
            }

            if (floorDeficit > 0 && nonFloorWeight > 0) {
                for (uint256 i = 0; i < n; i++) {
                    if (shares[i] > floorAmount && weights[i] > 0) {
                        uint256 deduction = (floorDeficit * weights[i]) / nonFloorWeight;
                        if (deduction < shares[i] - floorAmount) {
                            shares[i] -= deduction;
                        } else {
                            shares[i] = floorAmount;
                        }
                    }
                }
            }
        }

        // Step 4: Force efficiency on last non-zero-weight participant.
        // Preserves null player axiom: weight=0 => share=0.
        uint256 dustRecipient = n - 1;
        for (uint256 i = n; i > 0; i--) {
            if (weights[i - 1] > 0) { dustRecipient = i - 1; break; }
        }
        uint256 distributed = 0;
        for (uint256 i = 0; i < n; i++) {
            if (i != dustRecipient) distributed += shares[i];
        }
        shares[dustRecipient] = totalValue - distributed;
    }

    // ============ Settlement Layer Integration ============

    /**
     * @notice Settle a game using pre-verified Shapley values from ShapleyVerifier
     * @dev Instead of computing on-chain, pulls finalized results from the verifier.
     *      The verifier has already checked all Shapley axioms (efficiency, sanity,
     *      Lawson floor, merkle proof). This function just assigns the verified
     *      values to the game's participants.
     *
     *      DISINTERMEDIATION: DISSOLVED (Phase 2). Like computeShapleyValues(),
     *      this is deterministic given verified inputs. Anyone can trigger it.
     *      The ShapleyVerifier's dispute window provides the trust guarantee.
     *
     * @param gameId Game identifier (must match a game created via createGame)
     */
    function settleFromVerifier(bytes32 gameId) external {
        if (address(shapleyVerifier) == address(0)) revert VerifierNotSet();

        CooperativeGame storage game = games[gameId];
        if (game.totalValue == 0) revert GameNotFound();
        if (game.settled) revert GameAlreadySettled();

        // ABC Conservation Gate
        _requireABCHealthy(gameId);

        // Pull verified values — reverts inside verifier if not finalized
        (address[] memory participants, uint256[] memory values) =
            shapleyVerifier.getVerifiedValues(gameId);

        // Verify participant count matches the game
        Participant[] storage gamePs = gameParticipants[gameId];
        if (participants.length != gamePs.length) revert VerifierParticipantMismatch();

        // TRP-R19-F06: Verify that sum of verifier values matches game totalValue.
        // Without this, a verifier with a different totalPool could over-distribute
        // (draining other games' funds) or under-distribute (locking funds).
        {
            uint256 valueSum;
            for (uint256 j = 0; j < values.length; j++) {
                valueSum += values[j];
            }
            require(valueSum == game.totalValue, "TRP-R19-F06: Verifier total mismatch");
        }

        // TRP-R19-F01: Verify that verifier-returned addresses match stored participants.
        // Without this, a compromised verifier could redirect all rewards to arbitrary addresses.
        // Assign verified Shapley values directly.
        // The verifier already enforced efficiency (sum == totalPool),
        // sanity (no value > totalPool), and Lawson floor (>= 1% average)
        for (uint256 i = 0; i < participants.length; i++) {
            require(participants[i] == gamePs[i].participant, "TRP-R19-F01: Verifier address mismatch");
            shapleyValues[gameId][participants[i]] = values[i];
            emit ShapleyComputed(gameId, participants[i], values[i]);
        }

        game.settled = true;

        emit SettledFromVerifier(gameId, participants.length,
            shapleyVerifier.getVerifiedTotalPool(gameId));
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

        // Release committed balance tracking (per-token)
        if (totalCommittedBalance[game.token] >= amount) {
            totalCommittedBalance[game.token] -= amount;
        }

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
     * - Pioneer bonus: multiplier from PriorityRegistry (1.0x to 1.5x)
     */
    function _calculateWeightedContribution(
        Participant memory p,
        bytes32 gameId
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

        weighted = (weighted * qualityMultiplier) / PRECISION;

        // Pioneer bonus: query PriorityRegistry if configured
        // Only activates when BOTH registry and scopeId are set — zero overhead otherwise
        bytes32 scopeId = gameScopeId[gameId];
        if (address(priorityRegistry) != address(0) && scopeId != bytes32(0)) {
            uint256 pioneerScore = priorityRegistry.getPioneerScore(p.participant, scopeId);
            if (pioneerScore > 0) {
                // SECURITY: Cap pioneer score to prevent unbounded multiplier
                // Max 2 * BPS_PRECISION (20000) → 2.0x multiplier cap
                if (pioneerScore > 2 * BPS_PRECISION) pioneerScore = 2 * BPS_PRECISION;
                // Linear scaling: score / (2 * BPS_PRECISION) gives bonus fraction
                // score 5000  → 25% bonus (1.25x)
                // score 10000 → 50% bonus (1.5x) — pool creator
                // score 17500 → 87.5% bonus (1.875x) — pool creator + first LP
                // score 20000 → 100% bonus (2.0x) — CAPPED
                uint256 pioneerMultiplier = PRECISION + (pioneerScore * PRECISION) / (2 * BPS_PRECISION);
                weighted = (weighted * pioneerMultiplier) / PRECISION;
            }
        }

        return weighted;
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
     *
     * DISINTERMEDIATION: KEEP — quality weights affect reward distribution.
     * If permissionless, anyone could inflate their own quality scores.
     * Target: compute quality weights from on-chain data (trade history,
     * LP duration, governance participation) instead of off-chain input.
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
        // TRP-R23-F05: Prevent quality weight zero-manipulation.
        // With all scores at 0, the multiplier is 0.5x. With scores at 10000, it's 1.5x.
        // Max disparity is 3x, which is acceptable for quality differentiation.
        // Additional safeguard: at least one score must be non-zero to prevent complete suppression.
        require(
            activityScore > 0 || reputationScore > 0 || economicScore > 0,
            "At least one quality score must be nonzero"
        );

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

    /**
     * @notice Get the scope ID associated with a game (for pioneer lookup)
     */
    function getGameScopeId(bytes32 gameId) external view returns (bytes32) {
        return gameScopeId[gameId];
    }

    // ============ Game Cancellation ============

    /// @notice Cancel an unsettled game and release committed balance
    /// @dev TRP-R19-F07: Without this, unsettled games (e.g., ABC health gate blocks
    ///      settlement) permanently lock funds in totalCommittedBalance, eventually
    ///      bricking new game creation. Owner-only until governance transition.
    ///      DISINTERMEDIATION: Grade C → Target Grade B (TimelockController).
    function cancelStaleGame(bytes32 gameId) external onlyOwner {
        CooperativeGame storage game = games[gameId];
        require(game.totalValue > 0, "Game not found");
        require(!game.settled, "Game already settled");

        uint256 releasedValue = game.totalValue;
        address token = game.token;

        // Release committed balance
        if (totalCommittedBalance[token] >= releasedValue) {
            totalCommittedBalance[token] -= releasedValue;
        }

        // Mark as settled to prevent re-cancellation
        game.settled = true;
        game.totalValue = 0;

        emit GameCancelled(gameId, releasedValue, token);
    }

    /// @dev Emitted when a stale game is cancelled by owner
    event GameCancelled(bytes32 indexed gameId, uint256 releasedValue, address token);

    // ============ Admin Functions ============

    /// @notice DISINTERMEDIATION: KEEP — controls which contracts can create games with
    /// fabricated participant data. Security-critical until on-chain auto-creation exists.
    /// Target Grade B: governance (TimelockController).
    function setAuthorizedCreator(address creator, bool authorized) external onlyOwner {
        authorizedCreators[creator] = authorized;
        emit AuthorizedCreatorUpdated(creator, authorized);
    }

    /// @notice DISINTERMEDIATION: Grade C -> Target Grade B. Governance-appropriate.
    /// Participant limits are safety bounds — too low breaks games, too high causes OOG.
    /// @dev TRP-R19-F03: Added bounds validation. min=0 allows empty games,
    ///      max>500 risks OOG on computeShapleyValues O(n) loops.
    /// @dev TRP-R23-F04: maxParticipants capped at 100 = 1/LAWSON_FAIRNESS_FLOOR.
    ///      With LAWSON_FAIRNESS_FLOOR = 1%, n > 100 participants all needing floor boost
    ///      would require > 100% of pool, causing underflow revert in _applyFloorAndEfficiency.
    function setParticipantLimits(uint256 _min, uint256 _max) external onlyOwner {
        require(_min >= 2 && _max >= _min && _max <= 100, "Invalid limits: min>=2, max>=min, max<=100");
        minParticipants = _min;
        maxParticipants = _max;
        emit ParticipantLimitsUpdated(_min, _max);
    }

    /// @notice DISINTERMEDIATION: Grade C -> Target Grade B. Governance-appropriate.
    /// Feature toggle that affects reward calculation.
    function setUseQualityWeights(bool _use) external onlyOwner {
        useQualityWeights = _use;
        emit QualityWeightsToggled(_use);
    }

    // ============ Settlement Layer Admin ============

    /**
     * @notice Set the ShapleyVerifier for off-chain settlement
     * @dev address(0) disables verifier path (only on-chain compute available)
     * @param _verifier ShapleyVerifier address
     *
     * DISINTERMEDIATION: Grade C -> Target Grade B. Governance-appropriate.
     * Infrastructure wiring — changes which verifier provides Shapley values.
     */
    function setShapleyVerifier(address _verifier) external onlyOwner {
        shapleyVerifier = IShapleyVerifier(_verifier);
        emit ShapleyVerifierUpdated(_verifier);
    }

    // ============ Pioneer Admin Functions ============

    /**
     * @notice Set the PriorityRegistry for pioneer bonus lookup
     * @dev address(0) disables pioneer bonus (default)
     * @param _registry PriorityRegistry address
     *
     * DISINTERMEDIATION: Grade C -> Target Grade B. Governance-appropriate.
     * Infrastructure wiring — changes which registry provides pioneer scores.
     */
    function setPriorityRegistry(address _registry) external onlyOwner {
        priorityRegistry = IPriorityRegistry(_registry);
        emit PriorityRegistryUpdated(_registry);
    }

    /**
     * @notice Set optional sybil guard for Lawson Floor protection
     * @dev When set, only participants with verified unique identity receive
     *      the 1% floor boost. Prevents sybil splitting attack.
     *      Set to address(0) to disable.
     *
     * DISINTERMEDIATION: Grade B (GOVERNANCE) — sybil guard configuration
     * affects who gets floor protection. Should require DAO vote, not single owner.
     * Target: TimelockController + governance proposal.
     */
    function setSybilGuard(address _guard) external onlyOwner {
        sybilGuard = ISybilGuard(_guard);
        emit SybilGuardUpdated(_guard);
    }

    // ============ Halving Admin Functions ============

    /**
     * @notice Enable or disable halving schedule
     * @param _enabled Whether halving should be applied
     *
     * DISINTERMEDIATION: KEEP — halving toggle fundamentally changes tokenomics.
     * Disabling halving during an era would inflate token supply unexpectedly.
     * Target Grade B: governance (TimelockController) with significant delay.
     */
    function setHalvingEnabled(bool _enabled) external onlyOwner {
        halvingEnabled = _enabled;
        emit HalvingToggled(_enabled);
    }

    /**
     * @notice Set games per halving era
     * @dev Only affects future era calculations, not past games
     * @param _gamesPerEra New games per era value
     *
     * DISINTERMEDIATION: KEEP — changes halving schedule timing.
     * Target Grade B: governance (TimelockController).
     */
    function setGamesPerEra(uint256 _gamesPerEra) external onlyOwner {
        if (_gamesPerEra == 0) revert InvalidGamesPerEra();
        gamesPerEra = _gamesPerEra;
        emit GamesPerEraUpdated(_gamesPerEra);
    }

    /**
     * @notice Emergency reset of genesis timestamp (use with caution)
     * @dev Only for correcting deployment issues, not regular use
     *
     * DISINTERMEDIATION: KEEP — emergency-only. Resetting genesis manipulates
     * the entire halving schedule. Target Grade B: governance with delay.
     */
    function resetGenesisTimestamp() external onlyOwner {
        genesisTimestamp = block.timestamp;
        emit GenesisTimestampReset(block.timestamp);
    }

    // ============ Receive ETH ============

    receive() external payable {}

    // ============ UUPS ============

    /**
     * @dev Authorizes upgrades — but if the bonding curve is sealed,
     *      the seal MUST survive the upgrade. The new implementation
     *      inherits the same storage slot, so bondingCurve and
     *      bondingCurveSealed persist. This comment exists as a
     *      canonical warning: any implementation that removes the
     *      ABC health gate is a violation of P-000.
     *
     *      DISINTERMEDIATION: KEEP during bootstrap. Target Grade B via
     *      governance TimelockController. Upgrades are the highest-trust
     *      operation — must be last to dissolve.
     *
     *      "If something is clearly unfair, amending the code is a
     *       responsibility, a credo, a law, a canon."
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }
}
