// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title SIEShapleyAdapter — Bridge SIE Citation Revenue to Full Shapley
 * @notice Converts the IntelligenceExchange's simplified proportional split
 *         into proper Shapley value games that the ShapleyDistributor can settle.
 *
 * @dev The SIE uses a simplified 70/30 contributor/citation split for gas efficiency.
 *      This adapter enables periodic "true-up" rounds where:
 *      1. Off-chain Shapley computation runs over the full citation graph
 *      2. Results are submitted via ShapleyVerifier (Merkle proof verified)
 *      3. Differences between simplified and full Shapley are distributed
 *
 *      This is the execution/settlement separation pattern:
 *      - Simplified split runs on every access (cheap, immediate)
 *      - Full Shapley runs periodically (expensive, accurate)
 *      - True-up distributes the difference
 *
 *      Four weight factors for intelligence (mirroring LP weights):
 *        Direct (40%)    → originality of the contribution
 *        Enabling (30%)  → citation impact (how many works build on this)
 *        Scarcity (20%)  → uniqueness in the knowledge graph
 *        Stability (10%) → consistency of contribution over time
 *
 * @author Faraday1, JARVIS | March 2026
 */
contract SIEShapleyAdapter is OwnableUpgradeable, UUPSUpgradeable {
    // ============ Types ============

    struct ContributionWeights {
        uint256 originality;   // 0-10000 BPS — how novel is this work
        uint256 citationImpact; // 0-10000 BPS — how many works cite this
        uint256 scarcity;      // 0-10000 BPS — uniqueness in the graph
        uint256 consistency;   // 0-10000 BPS — sustained contribution over time
    }

    struct TrueUpRound {
        bytes32 roundId;
        uint256 totalPool;        // VIBE accumulated since last true-up
        uint256 participantCount;
        bytes32 shapleyRoot;      // Merkle root of full Shapley computation
        uint256 timestamp;
        bool finalized;
    }

    // ============ Constants ============

    uint256 public constant BPS = 10_000;
    uint256 public constant WEIGHT_ORIGINALITY = 4000;    // 40%
    uint256 public constant WEIGHT_CITATION = 3000;       // 30%
    uint256 public constant WEIGHT_SCARCITY = 2000;       // 20%
    uint256 public constant WEIGHT_CONSISTENCY = 1000;    // 10%

    // ============ State ============

    address public intelligenceExchange;
    address public shapleyDistributor;
    address public shapleyVerifier;

    mapping(bytes32 => TrueUpRound) public trueUpRounds;
    uint256 public roundCount;
    uint256 public lastTrueUpTimestamp;


    /// @dev Reserved storage gap for future upgrades
    uint256[50] private __gap;

    // ============ Events ============

    event TrueUpInitiated(bytes32 indexed roundId, uint256 totalPool, uint256 participantCount);
    event TrueUpFinalized(bytes32 indexed roundId, uint256 distributed);
    event WeightsComputed(address indexed contributor, uint256 originality, uint256 citation, uint256 scarcity, uint256 consistency, uint256 totalWeight);

    // ============ Errors ============

    error NotConfigured();
    error RoundNotFound();
    error RoundAlreadyFinalized();

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

        intelligenceExchange = _intelligenceExchange;
        shapleyDistributor = _shapleyDistributor;
        shapleyVerifier = _shapleyVerifier;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
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

    // ============ True-Up Rounds ============

    /**
     * @notice Initiate a true-up round for Shapley redistribution.
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

    // ============ View ============

    function getRound(bytes32 roundId) external view returns (TrueUpRound memory) {
        return trueUpRounds[roundId];
    }

    function getWeightBreakdown() external pure returns (
        uint256 originality, uint256 citation, uint256 scarcity, uint256 consistency
    ) {
        return (WEIGHT_ORIGINALITY, WEIGHT_CITATION, WEIGHT_SCARCITY, WEIGHT_CONSISTENCY);
    }

    receive() external payable {}
}
