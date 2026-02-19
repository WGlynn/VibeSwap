// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/ILiquidityGauge.sol";

/**
 * @title LiquidityGauge
 * @notice Curve-style gauge for directing token emissions to LP pools.
 * @dev Part of VSOS (VibeSwap Operating System) DeFi/DeFAI layer.
 *
 *      Mechanics:
 *        - LPs stake their LP tokens in gauges to earn reward emissions
 *        - Governance votes on gauge weights (which pools get what % of emissions)
 *        - Emissions distributed proportionally to staked LP within each gauge
 *        - Weekly epochs advance emission schedule
 *
 *      Cooperative capitalism:
 *        - Governance-directed: community decides which pools deserve incentives
 *        - No mercenary capital: staking requires commitment (no flash-stake)
 *        - Proportional rewards: Synthetix-style reward accumulator (fair to latecomers)
 *        - Epoch-based: predictable emission schedule, no surprise changes
 *
 *      Composability:
 *        - Gauges wrap any LP token (VibeLP, external LP, VibeLPNFT receipts)
 *        - Reward token configurable (JUL, VIBE, or any ERC-20)
 *        - Weights can be driven by ConvictionGovernance or QuadraticVoting
 */
contract LiquidityGauge is ILiquidityGauge, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant PRECISION = 1e18;
    uint256 public constant MAX_GAUGES = 100;

    // ============ State ============

    IERC20 private _rewardToken;
    uint256 private _emissionRate;   // tokens per second across all gauges
    uint256 private _epochDuration;
    uint256 private _currentEpoch;
    uint256 private _epochStartTime;
    uint256 private _totalWeight;

    // Pool ID → gauge info
    mapping(bytes32 => GaugeInfo) private _gauges;
    bytes32[] private _gaugeIds;
    mapping(bytes32 => bool) private _gaugeExists;

    // Pool ID → user → info
    mapping(bytes32 => mapping(address => UserInfo)) private _users;

    // ============ Constructor ============

    constructor(
        address rewardToken_,
        uint256 emissionRate_,
        uint256 epochDuration_
    ) Ownable(msg.sender) {
        if (rewardToken_ == address(0)) revert ZeroAddress();
        _rewardToken = IERC20(rewardToken_);
        _emissionRate = emissionRate_;
        _epochDuration = epochDuration_ > 0 ? epochDuration_ : 7 days;
        _epochStartTime = block.timestamp;
        _currentEpoch = 1;
    }

    // ============ Gauge Management ============

    function createGauge(bytes32 poolId, address lpToken) external onlyOwner {
        if (lpToken == address(0)) revert ZeroAddress();
        if (_gaugeExists[poolId]) revert GaugeAlreadyExists();
        if (_gaugeIds.length >= MAX_GAUGES) revert WeightsTooHigh();

        _gauges[poolId] = GaugeInfo({
            lpToken: lpToken,
            weight: 0,
            totalStaked: 0,
            rewardPerTokenStored: 0,
            lastUpdateTime: block.timestamp,
            active: true
        });

        _gaugeExists[poolId] = true;
        _gaugeIds.push(poolId);

        emit GaugeCreated(poolId, lpToken);
    }

    function killGauge(bytes32 poolId) external onlyOwner {
        if (!_gaugeExists[poolId]) revert GaugeNotFound();
        _updateReward(poolId, address(0));

        GaugeInfo storage gauge = _gauges[poolId];
        _totalWeight -= gauge.weight;
        gauge.weight = 0;
        gauge.active = false;

        emit GaugeKilled(poolId);
    }

    // ============ Staking ============

    function stake(bytes32 poolId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        GaugeInfo storage gauge = _gauges[poolId];
        if (!gauge.active) revert GaugeNotActive();

        _updateReward(poolId, msg.sender);

        IERC20(gauge.lpToken).safeTransferFrom(msg.sender, address(this), amount);

        gauge.totalStaked += amount;
        _users[poolId][msg.sender].staked += amount;

        emit Staked(poolId, msg.sender, amount);
    }

    function withdraw(bytes32 poolId, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (!_gaugeExists[poolId]) revert GaugeNotFound();

        UserInfo storage user = _users[poolId][msg.sender];
        if (user.staked < amount) revert InsufficientStake();

        _updateReward(poolId, msg.sender);

        user.staked -= amount;
        _gauges[poolId].totalStaked -= amount;

        IERC20(_gauges[poolId].lpToken).safeTransfer(msg.sender, amount);

        emit Withdrawn(poolId, msg.sender, amount);
    }

    // ============ Rewards ============

    function claimRewards(bytes32 poolId) external nonReentrant {
        if (!_gaugeExists[poolId]) revert GaugeNotFound();
        _updateReward(poolId, msg.sender);

        UserInfo storage user = _users[poolId][msg.sender];
        uint256 reward = user.pendingReward;
        if (reward == 0) revert NothingToClaim();

        user.pendingReward = 0;
        _rewardToken.safeTransfer(msg.sender, reward);

        emit RewardClaimed(poolId, msg.sender, reward);
    }

    function claimAllRewards(bytes32[] calldata poolIds) external nonReentrant {
        uint256 totalReward;

        for (uint256 i; i < poolIds.length; ++i) {
            bytes32 poolId = poolIds[i];
            if (!_gaugeExists[poolId]) continue;

            _updateReward(poolId, msg.sender);

            UserInfo storage user = _users[poolId][msg.sender];
            if (user.pendingReward > 0) {
                totalReward += user.pendingReward;
                emit RewardClaimed(poolId, msg.sender, user.pendingReward);
                user.pendingReward = 0;
            }
        }

        if (totalReward == 0) revert NothingToClaim();
        _rewardToken.safeTransfer(msg.sender, totalReward);
    }

    // ============ Epoch & Weight Management ============

    function updateWeights(
        bytes32[] calldata poolIds,
        uint256[] calldata weights
    ) external onlyOwner {
        if (poolIds.length != weights.length) revert ArrayLengthMismatch();

        // Update all gauges' reward accumulators first
        for (uint256 i; i < poolIds.length; ++i) {
            if (!_gaugeExists[poolIds[i]]) revert GaugeNotFound();
            _updateReward(poolIds[i], address(0));
        }

        // Apply new weights
        uint256 newTotalWeight;
        for (uint256 i; i < poolIds.length; ++i) {
            _gauges[poolIds[i]].weight = weights[i];
            newTotalWeight += weights[i];
        }

        // Add weights of gauges not in the update
        for (uint256 i; i < _gaugeIds.length; ++i) {
            bytes32 gId = _gaugeIds[i];
            bool inUpdate = false;
            for (uint256 j; j < poolIds.length; ++j) {
                if (poolIds[j] == gId) { inUpdate = true; break; }
            }
            if (!inUpdate) {
                newTotalWeight += _gauges[gId].weight;
            }
        }

        _totalWeight = newTotalWeight;

        emit WeightsUpdated(poolIds, weights);
    }

    function advanceEpoch() external {
        if (block.timestamp < _epochStartTime + _epochDuration) revert EpochNotReady();

        // Update all gauges before advancing
        for (uint256 i; i < _gaugeIds.length; ++i) {
            _updateReward(_gaugeIds[i], address(0));
        }

        uint256 totalEmissions = _emissionRate * _epochDuration;
        _currentEpoch++;
        _epochStartTime = block.timestamp;

        emit EpochAdvanced(_currentEpoch, totalEmissions);
    }

    function setEmissionRate(uint256 rate) external onlyOwner {
        // Update all gauges before changing rate
        for (uint256 i; i < _gaugeIds.length; ++i) {
            _updateReward(_gaugeIds[i], address(0));
        }

        _emissionRate = rate;
        emit EmissionRateUpdated(rate);
    }

    // ============ Views ============

    function gaugeInfo(bytes32 poolId) external view returns (GaugeInfo memory) {
        return _gauges[poolId];
    }

    function userInfo(bytes32 poolId, address user) external view returns (UserInfo memory) {
        return _users[poolId][user];
    }

    function pendingRewards(bytes32 poolId, address user) external view returns (uint256) {
        GaugeInfo storage gauge = _gauges[poolId];
        UserInfo storage uInfo = _users[poolId][user];

        uint256 rpt = gauge.rewardPerTokenStored;
        if (gauge.totalStaked > 0 && _totalWeight > 0) {
            uint256 elapsed = block.timestamp - gauge.lastUpdateTime;
            uint256 gaugeEmissions = (_emissionRate * elapsed * gauge.weight) / _totalWeight;
            rpt += (gaugeEmissions * PRECISION) / gauge.totalStaked;
        }

        return uInfo.pendingReward +
            (uInfo.staked * (rpt - uInfo.rewardPerTokenPaid)) / PRECISION;
    }

    function currentEpoch() external view returns (uint256) { return _currentEpoch; }
    function epochDuration() external view returns (uint256) { return _epochDuration; }
    function emissionRate() external view returns (uint256) { return _emissionRate; }
    function totalWeight() external view returns (uint256) { return _totalWeight; }
    function rewardToken() external view returns (address) { return address(_rewardToken); }

    function gaugeCount() external view returns (uint256) {
        return _gaugeIds.length;
    }

    // ============ Internal ============

    function _updateReward(bytes32 poolId, address account) internal {
        GaugeInfo storage gauge = _gauges[poolId];

        if (gauge.totalStaked > 0 && _totalWeight > 0) {
            uint256 elapsed = block.timestamp - gauge.lastUpdateTime;
            uint256 gaugeEmissions = (_emissionRate * elapsed * gauge.weight) / _totalWeight;
            gauge.rewardPerTokenStored += (gaugeEmissions * PRECISION) / gauge.totalStaked;
        }

        gauge.lastUpdateTime = block.timestamp;

        if (account != address(0)) {
            UserInfo storage user = _users[poolId][account];
            user.pendingReward +=
                (user.staked * (gauge.rewardPerTokenStored - user.rewardPerTokenPaid)) / PRECISION;
            user.rewardPerTokenPaid = gauge.rewardPerTokenStored;
        }
    }
}
