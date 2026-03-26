// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../incentives/interfaces/IShapleyDistributor.sol";
import "./ISIEShapleyAdapter.sol";

/**
 * @title SIEShapleyAdapter — Bridge SIE Citation Revenue to Full Shapley
 * @notice Converts the IntelligenceExchange's simplified proportional split
 *         into proper Shapley value games that the ShapleyDistributor can settle.
 *
 * @dev The SIE uses a simplified 70/30 contributor/citation split for gas efficiency.
 *      This adapter enables periodic "true-up" rounds where:
 *      1. SIE settlements trigger onSettlement(), accumulating contribution data
 *      2. executeTrueUp() translates accumulated data into ShapleyDistributor games
 *      3. ShapleyDistributor computes full Shapley values and distributes
 *
 *      This is the execution/settlement separation pattern:
 *      - Simplified split runs on every access (cheap, immediate)
 *      - Full Shapley runs periodically (expensive, accurate)
 *      - True-up distributes the difference
 *
 *      Four weight factors for intelligence (mirroring LP weights):
 *        Direct (40%)    -> originality of the contribution (bonding price = demand signal)
 *        Enabling (30%)  -> citation impact (how many works build on this)
 *        Scarcity (20%)  -> uniqueness in the knowledge graph
 *        Stability (10%) -> consistency of contribution over time
 *
 * @author Faraday1, JARVIS | March 2026
 */
contract SIEShapleyAdapter is
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    ISIEShapleyAdapter
{
    using SafeERC20 for IERC20;

    // ============ Types ============

    struct ContributionWeights {
        uint256 originality;    // 0-10000 BPS — how novel is this work
        uint256 citationImpact; // 0-10000 BPS — how many works cite this
        uint256 scarcity;       // 0-10000 BPS — uniqueness in the graph
        uint256 consistency;    // 0-10000 BPS — sustained contribution over time
    }

    struct TrueUpRound {
        bytes32 roundId;
        uint256 totalPool;        // VIBE accumulated since last true-up
        uint256 participantCount;
        bytes32 shapleyRoot;      // Merkle root of full Shapley computation
        bytes32 shapleyGameId;    // GameId created in ShapleyDistributor
        uint256 timestamp;
        bool finalized;
    }

    /// @notice Settlement record from a single SIE evaluation
    struct SettlementRecord {
        bytes32 assetId;
        address contributor;
        uint256 bondingPrice;     // Proxy for originality/demand
        uint256 citationCount;    // Number of citations (enabling impact)
        uint256 settledAt;
        bool verified;            // true = VERIFIED, false = DISPUTED
    }

    // ============ Constants ============

    uint256 public constant BPS = 10_000;
    uint256 public constant PRECISION = 1e18;
    uint256 public constant WEIGHT_ORIGINALITY = 4000;    // 40%
    uint256 public constant WEIGHT_CITATION = 3000;       // 30%
    uint256 public constant WEIGHT_SCARCITY = 2000;       // 20%
    uint256 public constant WEIGHT_CONSISTENCY = 1000;    // 10%

    /// @notice Maximum participants per true-up game (gas bound)
    uint256 public constant MAX_PARTICIPANTS_PER_GAME = 100;

    /// @notice Minimum time between true-ups (1 hour)
    uint256 public constant MIN_TRUE_UP_INTERVAL = 1 hours;

    // ============ State ============

    address public intelligenceExchange;
    address public shapleyDistributor;
    address public shapleyVerifier;
    IERC20 public vibeToken;

    mapping(bytes32 => TrueUpRound) public trueUpRounds;
    uint256 public roundCount;
    uint256 public lastTrueUpTimestamp;

    // ============ Settlement Accumulation ============

    /// @notice Settlements accumulated since the last true-up
    SettlementRecord[] public pendingSettlements;

    /// @notice Unique contributors in the current pending batch
    address[] public pendingContributors;

    /// @notice Tracks whether a contributor is already in the pending list
    mapping(address => bool) public isPendingContributor;

    /// @notice Total bonding price accumulated in pending settlements (pool proxy)
    uint256 public pendingTotalValue;

    /// @dev Reserved storage gap for future upgrades
    uint256[43] private __gap;

    // ============ Events ============

    event TrueUpInitiated(bytes32 indexed roundId, uint256 totalPool, uint256 participantCount);
    event TrueUpFinalized(bytes32 indexed roundId, uint256 distributed);
    event TrueUpExecuted(bytes32 indexed roundId, bytes32 indexed gameId, uint256 totalPool, uint256 participantCount);
    event SettlementAccumulated(bytes32 indexed assetId, address indexed contributor, bool verified, uint256 bondingPrice);
    event WeightsComputed(address indexed contributor, uint256 originality, uint256 citation, uint256 scarcity, uint256 consistency, uint256 totalWeight);
    event TrueUpPoolFunded(bytes32 indexed roundId, uint256 amount);

    // ============ Errors ============

    error NotConfigured();
    error NotIntelligenceExchange();
    error RoundNotFound();
    error RoundAlreadyFinalized();
    error NoPendingSettlements();
    error TrueUpTooSoon();
    error InsufficientPoolBalance();
    error TooManyParticipants();

    // ============ Modifiers ============

    modifier onlySIE() {
        if (msg.sender != intelligenceExchange) revert NotIntelligenceExchange();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(
        address _intelligenceExchange,
        address _shapleyDistributor,
        address _shapleyVerifier,
        address _owner
    ) external initializer {
        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        intelligenceExchange = _intelligenceExchange;
        shapleyDistributor = _shapleyDistributor;
        shapleyVerifier = _shapleyVerifier;
    }

    /**
     * @notice Set the VIBE token address (required before executeTrueUp)
     * @param _vibeToken Address of the VIBE ERC20 token
     */
    function setVibeToken(address _vibeToken) external onlyOwner {
        vibeToken = IERC20(_vibeToken);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Settlement Callback (Called by SIE) ============

    /**
     * @notice Called by IntelligenceExchange when an evaluation settles.
     *         Accumulates settlement data for the next true-up round.
     * @dev Only callable by the registered IntelligenceExchange address.
     *      Both verified and disputed settlements are recorded — disputed
     *      assets receive zero weight in true-up (null player axiom).
     * @param assetId The settled asset ID
     * @param contributor The asset's contributor address
     * @param verified Whether the asset was verified (true) or disputed (false)
     * @param bondingPrice The asset's current bonding curve price
     * @param citationCount Number of assets this work cites
     */
    function onSettlement(
        bytes32 assetId,
        address contributor,
        bool verified,
        uint256 bondingPrice,
        uint256 citationCount
    ) external override onlySIE {
        pendingSettlements.push(SettlementRecord({
            assetId: assetId,
            contributor: contributor,
            bondingPrice: bondingPrice,
            citationCount: citationCount,
            settledAt: block.timestamp,
            verified: verified
        }));

        // Track unique contributors
        if (!isPendingContributor[contributor]) {
            isPendingContributor[contributor] = true;
            pendingContributors.push(contributor);
        }

        if (verified) {
            pendingTotalValue += bondingPrice;
        }

        emit SettlementAccumulated(assetId, contributor, verified, bondingPrice);
    }

    // ============ Weight Computation ============

    /**
     * @notice Compute the four Shapley weight factors for a contributor.
     * @dev Off-chain computation submits these; on-chain verifies bounds.
     * @param originality How novel the contribution is (0-10000)
     * @param citationImpact How many works build on this (0-10000)
     * @param scarcity Uniqueness in the knowledge graph (0-10000)
     * @param consistency Sustained contribution over time (0-10000)
     * @return totalWeight The combined weight for Shapley distribution
     */
    function computeWeight(
        uint256 originality,
        uint256 citationImpact,
        uint256 scarcity,
        uint256 consistency
    ) public pure returns (uint256 totalWeight) {
        // Bound inputs
        if (originality > BPS) originality = BPS;
        if (citationImpact > BPS) citationImpact = BPS;
        if (scarcity > BPS) scarcity = BPS;
        if (consistency > BPS) consistency = BPS;

        totalWeight =
            (originality * WEIGHT_ORIGINALITY +
             citationImpact * WEIGHT_CITATION +
             scarcity * WEIGHT_SCARCITY +
             consistency * WEIGHT_CONSISTENCY) / BPS;
    }

    // ============ True-Up Execution ============

    /**
     * @notice Execute a true-up round: translate accumulated SIE settlements
     *         into a ShapleyDistributor cooperative game.
     *
     * @dev Flow:
     *      1. Aggregate pending settlements per contributor
     *      2. Compute 4-factor weights from on-chain data:
     *         - Originality = normalized bonding price (demand signal)
     *         - Citation Impact = normalized citation count
     *         - Scarcity = inverse of contributor count in batch (fewer = rarer)
     *         - Consistency = 1 for verified, 0 for disputed
     *      3. Build ShapleyDistributor.Participant[] array
     *      4. Transfer pool funds to ShapleyDistributor
     *      5. Call createGame() on ShapleyDistributor
     *      6. Clear pending state
     *
     * @param poolAmount Amount of VIBE to distribute in this true-up game.
     *        Must be pre-funded to this contract via ERC20 transfer.
     */
    function executeTrueUp(uint256 poolAmount) external nonReentrant onlyOwner {
        if (pendingSettlements.length == 0) revert NoPendingSettlements();
        if (block.timestamp < lastTrueUpTimestamp + MIN_TRUE_UP_INTERVAL) {
            revert TrueUpTooSoon();
        }

        uint256 contributorCount = pendingContributors.length;
        if (contributorCount > MAX_PARTICIPANTS_PER_GAME) revert TooManyParticipants();
        // ShapleyDistributor requires >= 2 participants
        if (contributorCount < 2) revert NoPendingSettlements();

        if (address(vibeToken) == address(0)) revert NotConfigured();
        if (vibeToken.balanceOf(address(this)) < poolAmount) revert InsufficientPoolBalance();

        // Step 1: Aggregate per-contributor data from settlements
        // Using temporary mappings via arrays since we know contributor indices
        uint256[] memory totalBonding = new uint256[](contributorCount);
        uint256[] memory totalCitations = new uint256[](contributorCount);
        uint256[] memory verifiedCount = new uint256[](contributorCount);
        uint256[] memory totalSettlements = new uint256[](contributorCount);

        // Build contributor index lookup
        // (pendingContributors[i] -> index i)
        for (uint256 s = 0; s < pendingSettlements.length; s++) {
            SettlementRecord storage sr = pendingSettlements[s];
            uint256 idx = _findContributorIndex(sr.contributor);

            totalBonding[idx] += sr.bondingPrice;
            totalCitations[idx] += sr.citationCount;
            totalSettlements[idx]++;
            if (sr.verified) {
                verifiedCount[idx]++;
            }
        }

        // Step 2: Compute max values for normalization
        uint256 maxBonding = 0;
        uint256 maxCitations = 0;
        for (uint256 i = 0; i < contributorCount; i++) {
            if (totalBonding[i] > maxBonding) maxBonding = totalBonding[i];
            if (totalCitations[i] > maxCitations) maxCitations = totalCitations[i];
        }

        // Step 3: Build Participant array for ShapleyDistributor
        IShapleyDistributor.Participant[] memory participants =
            new IShapleyDistributor.Participant[](contributorCount);

        for (uint256 i = 0; i < contributorCount; i++) {
            // Compute 4-factor weights (all normalized to 0-BPS)
            uint256 originality = maxBonding > 0
                ? (totalBonding[i] * BPS) / maxBonding
                : 0;

            uint256 citationImpact = maxCitations > 0
                ? (totalCitations[i] * BPS) / maxCitations
                : 0;

            // Scarcity: inverse of how common this contributor is in the batch
            // Fewer settlements = more scarce (they're a unique voice)
            uint256 scarcity = BPS / totalSettlements[i];
            if (scarcity > BPS) scarcity = BPS;

            // Consistency: ratio of verified to total settlements
            uint256 consistency = totalSettlements[i] > 0
                ? (verifiedCount[i] * BPS) / totalSettlements[i]
                : 0;

            // Combine into directContribution using weight formula
            uint256 directContribution = computeWeight(
                originality, citationImpact, scarcity, consistency
            );

            // Disputed-only contributors get zero (null player axiom)
            if (verifiedCount[i] == 0) {
                directContribution = 0;
            }

            participants[i] = IShapleyDistributor.Participant({
                participant: pendingContributors[i],
                directContribution: directContribution,
                timeInPool: block.timestamp - lastTrueUpTimestamp,
                scarcityScore: scarcity,
                stabilityScore: consistency
            });

            emit WeightsComputed(
                pendingContributors[i],
                originality, citationImpact, scarcity, consistency,
                directContribution
            );
        }

        // Step 4: Generate round and game IDs
        roundCount++;
        bytes32 roundId = keccak256(abi.encodePacked(roundCount, block.timestamp));
        bytes32 gameId = keccak256(abi.encodePacked("SIE_TRUEUP", roundId));

        // Step 5: Transfer pool to ShapleyDistributor
        vibeToken.safeTransfer(shapleyDistributor, poolAmount);

        // Step 6: Create game in ShapleyDistributor
        IShapleyDistributor(shapleyDistributor).createGame(
            gameId,
            poolAmount,
            address(vibeToken),
            participants
        );

        // Step 7: Record the round
        trueUpRounds[roundId] = TrueUpRound({
            roundId: roundId,
            totalPool: poolAmount,
            participantCount: contributorCount,
            shapleyRoot: bytes32(0),
            shapleyGameId: gameId,
            timestamp: block.timestamp,
            finalized: false
        });

        lastTrueUpTimestamp = block.timestamp;

        emit TrueUpInitiated(roundId, poolAmount, contributorCount);
        emit TrueUpExecuted(roundId, gameId, poolAmount, contributorCount);

        // Step 8: Clear pending state
        _clearPendingState();
    }

    // ============ Manual True-Up (Legacy/Override) ============

    /**
     * @notice Initiate a true-up round manually (legacy Phase 1 path).
     * @param totalPool Amount of VIBE accumulated since last true-up
     * @param participantCount Number of contributors in this round
     */
    function initiateTrueUp(uint256 totalPool, uint256 participantCount) external onlyOwner {
        roundCount++;
        bytes32 roundId = keccak256(abi.encodePacked(roundCount, block.timestamp));

        trueUpRounds[roundId] = TrueUpRound({
            roundId: roundId,
            totalPool: totalPool,
            participantCount: participantCount,
            shapleyRoot: bytes32(0),
            shapleyGameId: bytes32(0),
            timestamp: block.timestamp,
            finalized: false
        });

        lastTrueUpTimestamp = block.timestamp;
        emit TrueUpInitiated(roundId, totalPool, participantCount);
    }

    /**
     * @notice Finalize a true-up round with verified Shapley results.
     * @param roundId The round to finalize
     * @param shapleyRoot Merkle root of the full Shapley computation
     */
    function finalizeTrueUp(bytes32 roundId, bytes32 shapleyRoot) external onlyOwner {
        TrueUpRound storage round = trueUpRounds[roundId];
        if (round.timestamp == 0) revert RoundNotFound();
        if (round.finalized) revert RoundAlreadyFinalized();

        round.shapleyRoot = shapleyRoot;
        round.finalized = true;

        emit TrueUpFinalized(roundId, round.totalPool);
    }

    // ============ Internal ============

    /**
     * @dev Find the index of a contributor in the pendingContributors array.
     *      Linear scan is acceptable because MAX_PARTICIPANTS_PER_GAME = 100.
     */
    function _findContributorIndex(address contributor) internal view returns (uint256) {
        for (uint256 i = 0; i < pendingContributors.length; i++) {
            if (pendingContributors[i] == contributor) return i;
        }
        revert("Contributor not in pending list");
    }

    /**
     * @dev Clear all pending settlement state after a true-up execution.
     */
    function _clearPendingState() internal {
        // Clear isPendingContributor mapping
        for (uint256 i = 0; i < pendingContributors.length; i++) {
            delete isPendingContributor[pendingContributors[i]];
        }

        // Clear arrays by deleting
        delete pendingSettlements;
        delete pendingContributors;
        pendingTotalValue = 0;
    }

    // ============ Admin ============

    /**
     * @notice Update connected contract addresses.
     * @param _intelligenceExchange New SIE address
     * @param _shapleyDistributor New ShapleyDistributor address
     */
    function updateContracts(
        address _intelligenceExchange,
        address _shapleyDistributor
    ) external onlyOwner {
        if (_intelligenceExchange != address(0)) {
            intelligenceExchange = _intelligenceExchange;
        }
        if (_shapleyDistributor != address(0)) {
            shapleyDistributor = _shapleyDistributor;
        }
    }

    // ============ View ============

    function getRound(bytes32 roundId) external view returns (TrueUpRound memory) {
        return trueUpRounds[roundId];
    }

    function getWeightBreakdown() external pure returns (
        uint256 originality, uint256 citation, uint256 scarcity, uint256 consistency
    ) {
        return (WEIGHT_ORIGINALITY, WEIGHT_CITATION, WEIGHT_SCARCITY, WEIGHT_CONSISTENCY);
    }

    function getPendingSettlementCount() external view returns (uint256) {
        return pendingSettlements.length;
    }

    function getPendingContributorCount() external view returns (uint256) {
        return pendingContributors.length;
    }

    function getPendingSettlement(uint256 index) external view returns (SettlementRecord memory) {
        return pendingSettlements[index];
    }

    receive() external payable {}
}
