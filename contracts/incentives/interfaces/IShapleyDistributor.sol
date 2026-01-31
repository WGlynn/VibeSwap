// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IShapleyDistributor
 * @notice Interface for Shapley value-based reward distribution
 */
interface IShapleyDistributor {
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

    // ============ Game Management ============

    function createGame(
        bytes32 gameId,
        uint256 totalValue,
        address token,
        Participant[] calldata participants
    ) external;

    function computeShapleyValues(bytes32 gameId) external;

    function claimReward(bytes32 gameId) external returns (uint256 amount);

    // ============ Scarcity Calculation ============

    function calculateScarcityScore(
        uint256 buyVolume,
        uint256 sellVolume,
        bool participantSide,
        uint256 participantVolume
    ) external pure returns (uint256 scarcityScore);

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
}
