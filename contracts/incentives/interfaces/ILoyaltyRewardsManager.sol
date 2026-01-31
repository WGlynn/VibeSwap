// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ILoyaltyRewardsManager
 * @notice Interface for time-weighted LP loyalty rewards
 */
interface ILoyaltyRewardsManager {
    // Events
    event StakeRegistered(bytes32 indexed poolId, address indexed lp, uint256 liquidity);
    event StakeUpdated(bytes32 indexed poolId, address indexed lp, uint256 newLiquidity);
    event UnstakeRecorded(bytes32 indexed poolId, address indexed lp, uint256 liquidity, uint256 penalty);
    event RewardsClaimed(bytes32 indexed poolId, address indexed lp, uint256 amount);
    event PenaltyDistributed(bytes32 indexed poolId, uint256 toLPs, uint256 toTreasury);
    event TierConfigured(uint8 tier, uint64 minDuration, uint256 multiplierBps, uint256 penaltyBps);
    event RewardsDeposited(bytes32 indexed poolId, uint256 amount);

    // Structs
    struct LoyaltyPosition {
        uint256 liquidity;
        uint64 stakeTimestamp;
        uint256 accumulatedRewards;
        uint256 claimedRewards;
        uint256 rewardDebt;           // For reward per share calculation
    }

    struct LoyaltyTier {
        uint64 minDuration;           // Minimum seconds for this tier
        uint256 multiplierBps;        // Reward multiplier (10000 = 1x, 15000 = 1.5x)
        uint256 earlyExitPenaltyBps;  // Penalty for early exit (500 = 5%)
    }

    struct PoolRewardState {
        uint256 rewardPerShareAccumulated;  // Accumulated rewards per share (scaled 1e18)
        uint256 totalStaked;                 // Total liquidity staked
        uint256 pendingPenalties;            // Penalties waiting to be distributed
        uint64 lastRewardTimestamp;
    }

    // Stake management
    function registerStake(bytes32 poolId, address lp, uint256 liquidity) external;
    function updateStake(bytes32 poolId, address lp, uint256 newLiquidity) external;
    function recordUnstake(bytes32 poolId, address lp, uint256 liquidity) external returns (uint256 penalty);

    // Rewards
    function claimRewards(bytes32 poolId, address lp) external returns (uint256 amount);
    function depositRewards(bytes32 poolId, uint256 amount) external;
    function distributePenalties(bytes32 poolId) external;

    // View functions
    function getLoyaltyMultiplier(bytes32 poolId, address lp) external view returns (uint256 multiplierBps);
    function getCurrentTier(bytes32 poolId, address lp) external view returns (uint8 tier);
    function getPendingRewards(bytes32 poolId, address lp) external view returns (uint256);
    function getPosition(bytes32 poolId, address lp) external view returns (LoyaltyPosition memory);
    function getPoolState(bytes32 poolId) external view returns (PoolRewardState memory);
    function getTier(uint8 tierIndex) external view returns (LoyaltyTier memory);

    // Admin
    function configureTier(uint8 tierIndex, uint64 minDuration, uint256 multiplierBps, uint256 penaltyBps) external;
    function setTreasuryPenaltyShare(uint256 shareBps) external;
}
