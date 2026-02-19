// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ILiquidityGauge
 * @notice Curve-style gauge for directing token emissions to LP pools.
 *         Part of VSOS DeFi/DeFAI layer.
 */
interface ILiquidityGauge {
    // ============ Structs ============

    struct GaugeInfo {
        address lpToken;
        uint256 weight;
        uint256 totalStaked;
        uint256 rewardPerTokenStored;
        uint256 lastUpdateTime;
        bool active;
    }

    struct UserInfo {
        uint256 staked;
        uint256 rewardPerTokenPaid;
        uint256 pendingReward;
    }

    // ============ Events ============

    event GaugeCreated(bytes32 indexed poolId, address indexed lpToken);
    event GaugeKilled(bytes32 indexed poolId);
    event Staked(bytes32 indexed poolId, address indexed user, uint256 amount);
    event Withdrawn(bytes32 indexed poolId, address indexed user, uint256 amount);
    event RewardClaimed(bytes32 indexed poolId, address indexed user, uint256 amount);
    event WeightsUpdated(bytes32[] poolIds, uint256[] weights);
    event EpochAdvanced(uint256 indexed epoch, uint256 totalEmissions);
    event EmissionRateUpdated(uint256 newRate);
    event RewardTokenUpdated(address indexed newToken);

    // ============ Errors ============

    error GaugeAlreadyExists();
    error GaugeNotFound();
    error GaugeNotActive();
    error ZeroAmount();
    error ZeroAddress();
    error ArrayLengthMismatch();
    error WeightsTooHigh();
    error EpochNotReady();
    error InsufficientStake();
    error NothingToClaim();

    // ============ Views ============

    function gaugeInfo(bytes32 poolId) external view returns (GaugeInfo memory);
    function userInfo(bytes32 poolId, address user) external view returns (UserInfo memory);
    function pendingRewards(bytes32 poolId, address user) external view returns (uint256);
    function currentEpoch() external view returns (uint256);
    function epochDuration() external view returns (uint256);
    function emissionRate() external view returns (uint256);
    function totalWeight() external view returns (uint256);
    function rewardToken() external view returns (address);
    function gaugeCount() external view returns (uint256);

    // ============ Actions ============

    function createGauge(bytes32 poolId, address lpToken) external;
    function killGauge(bytes32 poolId) external;
    function stake(bytes32 poolId, uint256 amount) external;
    function withdraw(bytes32 poolId, uint256 amount) external;
    function claimRewards(bytes32 poolId) external;
    function claimAllRewards(bytes32[] calldata poolIds) external;
    function updateWeights(bytes32[] calldata poolIds, uint256[] calldata weights) external;
    function advanceEpoch() external;
    function setEmissionRate(uint256 rate) external;
}
