// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeRevShare
 * @notice Interface for ERC-20 Revenue Share Tokens — stakeable, tradeable,
 *         collateral-eligible tokens that auto-receive protocol revenue.
 *
 *         Part of VSOS (VibeSwap Operating System) Financial Primitives.
 *
 *         Co-op capitalist design:
 *           - Protocol revenue flows to the community, not a centralized entity
 *           - Proportional distribution via Synthetix accumulator pattern
 *           - Cooldown on unstaking = commitment, not passive extraction
 *           - ReputationOracle trust tiers earn reduced cooldowns (earned trust = flexibility)
 *           - JUL keeper tips for epoch maintenance
 *
 *         Anti-extractive properties:
 *           - Flash-loan protection via cooldown (can't stake-claim-unstake in one tx)
 *           - Revenue only accrues to staked tokens (skin-in-the-game required)
 *           - Authorized revenue sources prevent unauthorized dilution
 *           - Solvency invariant: totalDeposited >= totalClaimed + totalUnclaimed
 */
interface IVibeRevShare {
    // ============ Structs ============

    /// @notice Per-user staking state
    struct StakeInfo {
        uint256 stakedBalance;          // tokens currently staked
        uint256 rewardPerTokenPaid;     // snapshot of accumulator at last interaction
        uint256 pendingRewards;         // unclaimed revenue
        uint40 unstakeRequestTime;      // when unstake was requested (0 = none)
        uint256 unstakeRequestAmount;   // how much to unstake
    }

    // ============ Events ============

    event Staked(address indexed user, uint256 amount);
    event UnstakeRequested(address indexed user, uint256 amount, uint40 availableAt);
    event UnstakeCompleted(address indexed user, uint256 amount);
    event UnstakeCancelled(address indexed user, uint256 amount);
    event RevenueClaimed(address indexed user, uint256 amount);
    event RevenueDeposited(address indexed source, uint256 amount);
    event RevenueSourceUpdated(address indexed source, bool authorized);
    event JulRewardsDeposited(address indexed depositor, uint256 amount);
    event TokensMinted(address indexed to, uint256 amount);
    event TokensBurned(address indexed from, uint256 amount);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance();
    error InsufficientStake();
    error NoUnstakeRequest();
    error CooldownNotElapsed();
    error NotAuthorizedSource();
    error NothingToClaim();
    error UnstakePending();

    // ============ Owner Functions ============

    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function setRevenueSource(address source, bool authorized) external;
    function depositJulRewards(uint256 amount) external;

    // ============ Revenue Functions ============

    function depositRevenue(uint256 amount) external;

    // ============ Staking Functions ============

    function stake(uint256 amount) external;
    function requestUnstake(uint256 amount) external;
    function completeUnstake() external;
    function cancelUnstake() external;
    function claimRevenue() external;

    // ============ View Functions ============

    function earned(address user) external view returns (uint256);
    function rewardPerToken() external view returns (uint256);
    function stakedBalanceOf(address user) external view returns (uint256);
    function totalStaked() external view returns (uint256);
    function totalRevenueDeposited() external view returns (uint256);
    function totalRevenueClaimed() external view returns (uint256);
    function effectiveCooldown(address user) external view returns (uint256);
    function cooldownRemaining(address user) external view returns (uint256);
    function getStakeInfo(address user) external view returns (StakeInfo memory);
    function authorizedSources(address source) external view returns (bool);
}
