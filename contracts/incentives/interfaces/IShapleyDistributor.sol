// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IShapleyDistributor
 * @notice Interface for Shapley value-based reward distribution
 * @dev TRP-R19-K01: Expanded from skeleton to match full implementation surface.
 *      Prior version was missing 14+ public functions, blocking cross-contract integration.
 */
interface IShapleyDistributor {
    // ============ Enums ============

    enum GameType {
        FEE_DISTRIBUTION,   // Time-neutral: same work = same reward regardless of era
        TOKEN_EMISSION      // Subject to halving schedule
    }

    // ============ Structs ============

    struct Participant {
        address participant;
        uint256 directContribution;
        uint256 timeInPool;
        uint256 scarcityScore;
        uint256 stabilityScore;
    }

    struct CooperativeGame {
        bytes32 gameId;
        uint256 totalValue;
        address token;
        GameType gameType;
        bool settled;
    }

    struct QualityWeight {
        uint256 activityScore;
        uint256 reputationScore;
        uint256 economicScore;
        uint64 lastUpdate;
    }

    // ============ Events ============

    event GameCreated(bytes32 indexed gameId, uint256 totalValue, address token, uint256 participantCount);
    event ShapleyComputed(bytes32 indexed gameId, address indexed participant, uint256 shapleyValue);
    event RewardClaimed(bytes32 indexed gameId, address indexed participant, uint256 amount);
    event QualityWeightUpdated(address indexed participant, uint256 activity, uint256 reputation, uint256 economic);
    event HalvingApplied(bytes32 indexed gameId, uint256 originalValue, uint256 adjustedValue, uint8 era);
    event GameCancelled(bytes32 indexed gameId, uint256 releasedValue, address token);

    // ============ Game Creation ============

    function createGame(
        bytes32 gameId,
        uint256 totalValue,
        address token,
        Participant[] calldata participants
    ) external;

    function createGameTyped(
        bytes32 gameId,
        uint256 totalValue,
        address token,
        GameType gameType,
        Participant[] calldata participants
    ) external;

    function createGameFull(
        bytes32 gameId,
        uint256 totalValue,
        address token,
        GameType gameType,
        bytes32 scopeId,
        Participant[] calldata participants
    ) external;

    // ============ Settlement ============

    function computeShapleyValues(bytes32 gameId) external;
    function settleFromVerifier(bytes32 gameId) external;
    function cancelStaleGame(bytes32 gameId) external;

    // ============ Claims ============

    function claimReward(bytes32 gameId) external returns (uint256 amount);

    // ============ Scarcity Calculation ============

    function calculateScarcityScore(
        uint256 buyVolume,
        uint256 sellVolume,
        bool participantSide,
        uint256 participantVolume
    ) external pure returns (uint256 scarcityScore);

    // ============ Fairness Verification ============

    function verifyPairwiseFairness(bytes32 gameId) external view returns (bool fair, uint256 maxDeviation);
    function verifyTimeNeutrality(bytes32 gameId) external view returns (bool neutral);

    // ============ Quality Weights ============

    function updateQualityWeight(
        address participant,
        uint256 activityScore,
        uint256 reputationScore,
        uint256 economicScore
    ) external;

    // ============ View Functions ============

    function getShapleyValue(bytes32 gameId, address participant) external view returns (uint256);
    function getGameParticipants(bytes32 gameId) external view returns (Participant[] memory);
    function isGameSettled(bytes32 gameId) external view returns (bool);
    function getPendingReward(bytes32 gameId, address participant) external view returns (uint256);
    function getWeightedContribution(bytes32 gameId, address participant) external view returns (uint256);
    function getGameType(bytes32 gameId) external view returns (GameType);
    function getGameScopeId(bytes32 gameId) external view returns (bytes32);

    // ============ Halving ============

    function getCurrentHalvingEra() external view returns (uint8);
    function getEmissionMultiplier(uint8 era) external pure returns (uint256);
    function getHalvingInfo() external view returns (uint8 era, uint256 multiplier, uint256 gamesInEra, uint256 gamesPerEra);
    function gamesUntilNextHalving() external view returns (uint256);

    // ============ ABC Gate ============

    function sealBondingCurve() external;

    // ============ Admin ============

    function setAuthorizedCreator(address creator, bool authorized) external;
    function setParticipantLimits(uint256 _min, uint256 _max) external;
    function setUseQualityWeights(bool _use) external;
    function setShapleyVerifier(address _verifier) external;
    function setPriorityRegistry(address _registry) external;
    function setSybilGuard(address _guard) external;
    function setHalvingEnabled(bool _enabled) external;
    function setGamesPerEra(uint256 _gamesPerEra) external;
}
