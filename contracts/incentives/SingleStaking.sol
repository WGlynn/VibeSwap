// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ISingleStaking.sol";

/**
 * @title SingleStaking
 * @notice Synthetix-style single-sided staking rewards.
 * @dev Part of VSOS (VibeSwap Operating System) incentives layer.
 *
 *      Stake any ERC-20, earn reward tokens proportional to share of pool.
 *      Uses the Synthetix `rewardPerToken` accumulator for O(1) reward distribution.
 *
 *      Use cases:
 *        - Stake JUL, earn VIBE (protocol token staking)
 *        - Stake VIBE, earn JUL (governance staking)
 *        - Stake LP tokens, earn bonus rewards (beyond gauge emissions)
 *        - Stake contribution tokens, earn protocol revenue
 *
 *      Reward distribution:
 *        - Owner calls notifyRewardAmount(amount, duration) to start/extend a reward period
 *        - Rewards distribute linearly over the duration
 *        - rewardPerToken accumulates proportionally to each staker's share
 *        - Stakers can claim earned rewards at any time
 *
 *      Cooperative capitalism:
 *        - Fair: rewards proportional to stake × time
 *        - Transparent: all reward rates and schedules on-chain
 *        - No lockup: stakers can exit at any time
 *        - Composable: works with any ERC-20 pair
 */
contract SingleStaking is ISingleStaking, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant PRECISION = 1e18;

    // ============ State ============

    address private _stakingToken;
    address private _rewardToken;

    uint256 private _totalStaked;
    uint256 private _rewardRate;
    uint256 private _rewardPerTokenStored;
    uint256 private _lastUpdateTime;
    uint256 private _periodFinish;
    uint256 private _rewardDuration;

    mapping(address => uint256) private _balances;
    mapping(address => uint256) private _userRewardPerTokenPaid;
    mapping(address => uint256) private _rewards;

    // ============ Constructor ============

    constructor(
        address stakingToken_,
        address rewardToken_
    ) Ownable(msg.sender) {
        if (stakingToken_ == address(0)) revert ZeroAddress();
        if (rewardToken_ == address(0)) revert ZeroAddress();

        _stakingToken = stakingToken_;
        _rewardToken = rewardToken_;
    }

    // ============ Modifiers ============

    modifier updateReward(address account) {
        _rewardPerTokenStored = _rewardPerToken();
        _lastUpdateTime = _lastTimeRewardApplicable();
        if (account != address(0)) {
            _rewards[account] = _earned(account);
            _userRewardPerTokenPaid[account] = _rewardPerTokenStored;
        }
        _;
    }

    // ============ Staking ============

    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        IERC20(_stakingToken).safeTransferFrom(msg.sender, address(this), amount);

        _balances[msg.sender] += amount;
        _totalStaked += amount;

        emit Staked(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant updateReward(msg.sender) {
        _withdraw(msg.sender, amount);
    }

    function claimReward() external nonReentrant updateReward(msg.sender) {
        _claimReward(msg.sender);
    }

    function exit() external nonReentrant updateReward(msg.sender) {
        uint256 bal = _balances[msg.sender];
        if (bal > 0) {
            _withdraw(msg.sender, bal);
        }
        if (_rewards[msg.sender] > 0) {
            _claimReward(msg.sender);
        }
    }

    function _withdraw(address account, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        if (_balances[account] < amount) revert InsufficientStake();

        _balances[account] -= amount;
        _totalStaked -= amount;

        IERC20(_stakingToken).safeTransfer(account, amount);

        emit Withdrawn(account, amount);
    }

    function _claimReward(address account) internal {
        uint256 reward = _rewards[account];
        if (reward == 0) revert NothingToClaim();

        _rewards[account] = 0;
        IERC20(_rewardToken).safeTransfer(account, reward);

        emit RewardClaimed(account, reward);
    }

    // ============ Reward Management ============

    function notifyRewardAmount(uint256 amount, uint256 duration) external onlyOwner updateReward(address(0)) {
        if (amount == 0) revert ZeroAmount();
        if (duration == 0) revert ZeroAmount();

        IERC20(_rewardToken).safeTransferFrom(msg.sender, address(this), amount);

        if (block.timestamp >= _periodFinish) {
            _rewardRate = amount / duration;
        } else {
            uint256 remaining = _periodFinish - block.timestamp;
            uint256 leftover = remaining * _rewardRate;
            _rewardRate = (amount + leftover) / duration;
        }

        // Solvency check: reward rate should not exceed balance / duration
        uint256 balance = IERC20(_rewardToken).balanceOf(address(this));
        if (_stakingToken == _rewardToken) {
            // If same token, subtract staked amount
            balance -= _totalStaked;
        }
        if (_rewardRate > balance / duration) revert RewardRateTooHigh();

        _rewardDuration = duration;
        _lastUpdateTime = block.timestamp;
        _periodFinish = block.timestamp + duration;

        emit RewardAdded(amount, duration);
    }

    // ============ Internal ============

    function _lastTimeRewardApplicable() internal view returns (uint256) {
        return block.timestamp < _periodFinish ? block.timestamp : _periodFinish;
    }

    function _rewardPerToken() internal view returns (uint256) {
        if (_totalStaked == 0) {
            return _rewardPerTokenStored;
        }

        return _rewardPerTokenStored +
            ((_lastTimeRewardApplicable() - _lastUpdateTime) * _rewardRate * PRECISION) / _totalStaked;
    }

    function _earned(address account) internal view returns (uint256) {
        return (_balances[account] * (_rewardPerToken() - _userRewardPerTokenPaid[account])) / PRECISION
            + _rewards[account];
    }

    // ============ Views ============

    function stakingToken() external view returns (address) { return _stakingToken; }
    function rewardToken() external view returns (address) { return _rewardToken; }
    function totalStaked() external view returns (uint256) { return _totalStaked; }
    function stakeOf(address account) external view returns (uint256) { return _balances[account]; }
    function earned(address account) external view returns (uint256) { return _earned(account); }
    function rewardRate() external view returns (uint256) { return _rewardRate; }
    function rewardPerTokenStored() external view returns (uint256) { return _rewardPerTokenStored; }
    function lastUpdateTime() external view returns (uint256) { return _lastUpdateTime; }
    function periodFinish() external view returns (uint256) { return _periodFinish; }
    function rewardDuration() external view returns (uint256) { return _rewardDuration; }
}
