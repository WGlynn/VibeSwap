// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ILoyaltyRewardsManager.sol";

/**
 * @title LoyaltyRewardsManager
 * @notice Time-weighted LP rewards with loyalty multipliers and early exit penalties
 * @dev Rewards long-term LPs and redistributes early exit penalties to remaining stakers
 */
contract LoyaltyRewardsManager is
    ILoyaltyRewardsManager,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS_PRECISION = 10000;
    uint256 public constant PRECISION = 1e18;
    uint8 public constant MAX_TIERS = 4;

    // ============ State ============

    address public incentiveController;
    address public treasury;
    address public rewardToken;

    // Loyalty tiers (index 0-3)
    LoyaltyTier[4] public loyaltyTiers;

    // Pool ID => LP => Position
    mapping(bytes32 => mapping(address => LoyaltyPosition)) public loyaltyPositions;

    // Pool ID => Reward state
    mapping(bytes32 => PoolRewardState) public poolStates;

    // Treasury share of penalties (rest goes to LPs)
    uint256 public treasuryPenaltyShareBps;

    // Stats
    uint256 public totalPenaltiesCollected;
    uint256 public totalRewardsDistributed;

    // ============ Errors ============

    error Unauthorized();
    error InvalidTier();
    error InvalidAmount();
    error NoPosition();
    error ZeroAddress();
    error InsufficientStake();

    // ============ Modifiers ============

    modifier onlyController() {
        if (msg.sender != incentiveController) revert Unauthorized();
        _;
    }

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _incentiveController,
        address _treasury,
        address _rewardToken
    ) external initializer {
        if (_incentiveController == address(0) ||
            _treasury == address(0) ||
            _rewardToken == address(0)) {
            revert ZeroAddress();
        }

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        incentiveController = _incentiveController;
        treasury = _treasury;
        rewardToken = _rewardToken;
        treasuryPenaltyShareBps = 3000; // 30% to treasury, 70% to LPs

        // Initialize default tiers
        loyaltyTiers[0] = LoyaltyTier({
            minDuration: 7 days,
            multiplierBps: 10000,    // 1.0x
            earlyExitPenaltyBps: 500 // 5%
        });

        loyaltyTiers[1] = LoyaltyTier({
            minDuration: 30 days,
            multiplierBps: 12500,    // 1.25x
            earlyExitPenaltyBps: 300 // 3%
        });

        loyaltyTiers[2] = LoyaltyTier({
            minDuration: 90 days,
            multiplierBps: 15000,    // 1.5x
            earlyExitPenaltyBps: 100 // 1%
        });

        loyaltyTiers[3] = LoyaltyTier({
            minDuration: 365 days,
            multiplierBps: 20000,    // 2.0x
            earlyExitPenaltyBps: 0   // 0%
        });
    }

    // ============ External Functions ============

    /**
     * @notice Register a new stake
     * @param poolId Pool identifier
     * @param lp LP address
     * @param liquidity Liquidity amount
     */
    function registerStake(
        bytes32 poolId,
        address lp,
        uint256 liquidity
    ) external override onlyController {
        if (liquidity == 0) revert InvalidAmount();

        LoyaltyPosition storage position = loyaltyPositions[poolId][lp];
        PoolRewardState storage poolState = poolStates[poolId];

        // If existing position, harvest pending rewards first
        if (position.liquidity > 0) {
            uint256 pending = _calculatePendingRewards(poolId, lp);
            position.accumulatedRewards += pending;
        }

        // Update position
        position.liquidity += liquidity;
        position.stakeTimestamp = uint64(block.timestamp);
        position.rewardDebt = (position.liquidity * poolState.rewardPerShareAccumulated) / PRECISION;

        // Update pool state
        poolState.totalStaked += liquidity;

        emit StakeRegistered(poolId, lp, liquidity);
    }

    /**
     * @notice Update stake amount
     * @param poolId Pool identifier
     * @param lp LP address
     * @param newLiquidity New total liquidity
     */
    function updateStake(
        bytes32 poolId,
        address lp,
        uint256 newLiquidity
    ) external override onlyController {
        LoyaltyPosition storage position = loyaltyPositions[poolId][lp];
        if (position.liquidity == 0) revert NoPosition();

        PoolRewardState storage poolState = poolStates[poolId];

        // Harvest pending rewards
        uint256 pending = _calculatePendingRewards(poolId, lp);
        position.accumulatedRewards += pending;

        // Update totals
        if (newLiquidity > position.liquidity) {
            poolState.totalStaked += (newLiquidity - position.liquidity);
        } else {
            poolState.totalStaked -= (position.liquidity - newLiquidity);
        }

        position.liquidity = newLiquidity;
        position.rewardDebt = (newLiquidity * poolState.rewardPerShareAccumulated) / PRECISION;

        emit StakeUpdated(poolId, lp, newLiquidity);
    }

    /**
     * @notice Record unstake and calculate penalty
     * @param poolId Pool identifier
     * @param lp LP address
     * @param liquidity Amount being unstaked
     */
    function recordUnstake(
        bytes32 poolId,
        address lp,
        uint256 liquidity
    ) external override onlyController returns (uint256 penalty) {
        LoyaltyPosition storage position = loyaltyPositions[poolId][lp];
        if (position.liquidity == 0) revert NoPosition();
        if (liquidity > position.liquidity) revert InsufficientStake();

        PoolRewardState storage poolState = poolStates[poolId];

        // Harvest pending rewards first
        uint256 pending = _calculatePendingRewards(poolId, lp);
        position.accumulatedRewards += pending;

        // Calculate penalty based on current tier
        uint8 currentTier = _getCurrentTier(position.stakeTimestamp);
        LoyaltyTier storage tierConfig = loyaltyTiers[currentTier];

        // Penalty on the portion being withdrawn
        penalty = (liquidity * tierConfig.earlyExitPenaltyBps) / BPS_PRECISION;

        if (penalty > 0) {
            // Add to pending penalties for distribution
            poolState.pendingPenalties += penalty;
            totalPenaltiesCollected += penalty;
        }

        // Update position
        position.liquidity -= liquidity;
        position.rewardDebt = (position.liquidity * poolState.rewardPerShareAccumulated) / PRECISION;

        // Update pool state
        poolState.totalStaked -= liquidity;

        emit UnstakeRecorded(poolId, lp, liquidity, penalty);
    }

    /**
     * @notice Claim accumulated rewards
     * @param poolId Pool identifier
     * @param lp LP address
     */
    function claimRewards(
        bytes32 poolId,
        address lp
    ) external override nonReentrant returns (uint256 amount) {
        // Allow LP to claim for themselves or controller on behalf
        if (msg.sender != lp && msg.sender != incentiveController) {
            revert Unauthorized();
        }

        LoyaltyPosition storage position = loyaltyPositions[poolId][lp];
        if (position.liquidity == 0 && position.accumulatedRewards == 0) {
            revert NoPosition();
        }

        PoolRewardState storage poolState = poolStates[poolId];

        // Calculate pending
        uint256 pending = _calculatePendingRewards(poolId, lp);
        amount = position.accumulatedRewards + pending;

        if (amount == 0) return 0;

        // Apply loyalty multiplier
        uint8 tier = _getCurrentTier(position.stakeTimestamp);
        uint256 multiplier = loyaltyTiers[tier].multiplierBps;
        amount = (amount * multiplier) / BPS_PRECISION;

        // Update state
        position.accumulatedRewards = 0;
        position.claimedRewards += amount;
        position.rewardDebt = (position.liquidity * poolState.rewardPerShareAccumulated) / PRECISION;

        totalRewardsDistributed += amount;

        // Transfer
        IERC20(rewardToken).safeTransfer(lp, amount);

        emit RewardsClaimed(poolId, lp, amount);
    }

    /**
     * @notice Deposit rewards for a pool
     * @param poolId Pool identifier
     * @param amount Amount to deposit
     */
    function depositRewards(
        bytes32 poolId,
        uint256 amount
    ) external override {
        if (amount == 0) revert InvalidAmount();

        IERC20(rewardToken).safeTransferFrom(msg.sender, address(this), amount);

        PoolRewardState storage poolState = poolStates[poolId];

        if (poolState.totalStaked > 0) {
            poolState.rewardPerShareAccumulated += (amount * PRECISION) / poolState.totalStaked;
        }

        poolState.lastRewardTimestamp = uint64(block.timestamp);

        emit RewardsDeposited(poolId, amount);
    }

    /**
     * @notice Distribute accumulated penalties to LPs
     * @param poolId Pool identifier
     */
    function distributePenalties(bytes32 poolId) external override {
        PoolRewardState storage poolState = poolStates[poolId];

        uint256 penalties = poolState.pendingPenalties;
        if (penalties == 0) return;

        poolState.pendingPenalties = 0;

        // Split between treasury and LPs
        uint256 toTreasury = (penalties * treasuryPenaltyShareBps) / BPS_PRECISION;
        uint256 toLPs = penalties - toTreasury;

        // Send to treasury
        if (toTreasury > 0) {
            IERC20(rewardToken).safeTransfer(treasury, toTreasury);
        }

        // Add to LP rewards
        if (toLPs > 0 && poolState.totalStaked > 0) {
            poolState.rewardPerShareAccumulated += (toLPs * PRECISION) / poolState.totalStaked;
        }

        emit PenaltyDistributed(poolId, toLPs, toTreasury);
    }

    // ============ View Functions ============

    function getLoyaltyMultiplier(
        bytes32 poolId,
        address lp
    ) external view override returns (uint256 multiplierBps) {
        LoyaltyPosition storage position = loyaltyPositions[poolId][lp];
        if (position.liquidity == 0) return BPS_PRECISION; // 1x default

        uint8 tier = _getCurrentTier(position.stakeTimestamp);
        return loyaltyTiers[tier].multiplierBps;
    }

    function getCurrentTier(
        bytes32 poolId,
        address lp
    ) external view override returns (uint8 tier) {
        LoyaltyPosition storage position = loyaltyPositions[poolId][lp];
        if (position.liquidity == 0) return 0;

        return _getCurrentTier(position.stakeTimestamp);
    }

    function getPendingRewards(
        bytes32 poolId,
        address lp
    ) external view override returns (uint256) {
        LoyaltyPosition storage position = loyaltyPositions[poolId][lp];
        uint256 pending = _calculatePendingRewards(poolId, lp);

        // Apply multiplier
        uint8 tier = _getCurrentTier(position.stakeTimestamp);
        uint256 total = position.accumulatedRewards + pending;

        return (total * loyaltyTiers[tier].multiplierBps) / BPS_PRECISION;
    }

    function getPosition(
        bytes32 poolId,
        address lp
    ) external view override returns (LoyaltyPosition memory) {
        return loyaltyPositions[poolId][lp];
    }

    function getPoolState(bytes32 poolId) external view override returns (PoolRewardState memory) {
        return poolStates[poolId];
    }

    function getTier(uint8 tierIndex) external view override returns (LoyaltyTier memory) {
        if (tierIndex >= MAX_TIERS) revert InvalidTier();
        return loyaltyTiers[tierIndex];
    }

    // ============ Internal Functions ============

    function _calculatePendingRewards(
        bytes32 poolId,
        address lp
    ) internal view returns (uint256) {
        LoyaltyPosition storage position = loyaltyPositions[poolId][lp];
        PoolRewardState storage poolState = poolStates[poolId];

        if (position.liquidity == 0) return 0;

        uint256 accumulatedReward = (position.liquidity * poolState.rewardPerShareAccumulated) / PRECISION;

        if (accumulatedReward <= position.rewardDebt) return 0;

        return accumulatedReward - position.rewardDebt;
    }

    function _getCurrentTier(uint64 stakeTimestamp) internal view returns (uint8) {
        uint256 duration = block.timestamp - stakeTimestamp;

        // Check tiers in reverse order (highest first)
        for (uint8 i = MAX_TIERS; i > 0; i--) {
            if (duration >= loyaltyTiers[i - 1].minDuration) {
                return i - 1;
            }
        }

        return 0; // Default to tier 0
    }

    // ============ Admin Functions ============

    function configureTier(
        uint8 tierIndex,
        uint64 minDuration,
        uint256 multiplierBps,
        uint256 penaltyBps
    ) external override onlyOwner {
        if (tierIndex >= MAX_TIERS) revert InvalidTier();

        loyaltyTiers[tierIndex] = LoyaltyTier({
            minDuration: minDuration,
            multiplierBps: multiplierBps,
            earlyExitPenaltyBps: penaltyBps
        });

        emit TierConfigured(tierIndex, minDuration, multiplierBps, penaltyBps);
    }

    function setTreasuryPenaltyShare(uint256 shareBps) external override onlyOwner {
        if (shareBps > BPS_PRECISION) revert InvalidAmount();
        treasuryPenaltyShareBps = shareBps;
    }

    function setIncentiveController(address _controller) external onlyOwner {
        if (_controller == address(0)) revert ZeroAddress();
        incentiveController = _controller;
    }

    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert ZeroAddress();
        treasury = _treasury;
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
