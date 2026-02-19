// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISingleStaking
 * @notice Single-sided staking rewards — stake token, earn rewards.
 *         Part of VSOS (VibeSwap Operating System) incentives layer.
 */
interface ISingleStaking {
    // ============ Events ============

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardAdded(uint256 amount, uint256 duration);
    event EmergencyWithdrawn(address indexed user, uint256 amount);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientStake();
    error NothingToClaim();
    error RewardDurationNotFinished();
    error RewardRateTooHigh();

    // ============ Views ============

    function stakingToken() external view returns (address);
    function rewardToken() external view returns (address);
    function totalStaked() external view returns (uint256);
    function stakeOf(address account) external view returns (uint256);
    function earned(address account) external view returns (uint256);
    function rewardRate() external view returns (uint256);
    function rewardPerTokenStored() external view returns (uint256);
    function lastUpdateTime() external view returns (uint256);
    function periodFinish() external view returns (uint256);
    function rewardDuration() external view returns (uint256);

    // ============ Actions ============

    function stake(uint256 amount) external;
    function withdraw(uint256 amount) external;
    function claimReward() external;
    function exit() external;
    function notifyRewardAmount(uint256 amount, uint256 duration) external;
}
