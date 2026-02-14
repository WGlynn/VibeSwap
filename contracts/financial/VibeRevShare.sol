// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IVibeRevShare.sol";
import "../oracle/IReputationOracle.sol";

/**
 * @title VibeRevShare
 * @notice ERC-20 Revenue Share Tokens — stakeable, tradeable, collateral-eligible
 *         tokens that auto-receive a percentage of protocol revenue.
 * @dev Part of VSOS (VibeSwap Operating System) Financial Primitives.
 *
 *      Revenue distribution uses the Synthetix RewardsDistributor accumulator
 *      pattern for O(1) per-user accounting regardless of participant count.
 *
 *      Co-op capitalist mechanics:
 *        - Staking required to earn revenue (skin-in-the-game)
 *        - Cooldown on unstaking prevents flash-loan revenue capture
 *        - Reputation tiers reduce cooldown (earned trust = more flexibility)
 *        - JUL keeper tips for system maintenance
 *        - Authorized revenue sources prevent unauthorized dilution
 *
 *      Lifecycle: mint → stake → [revenue deposits accumulate] → claim → requestUnstake → completeUnstake
 */
contract VibeRevShare is ERC20, Ownable, ReentrancyGuard, IVibeRevShare {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant BPS = 10_000;
    uint256 private constant PRECISION = 1e18;
    uint256 private constant BASE_COOLDOWN = 7 days;
    uint256 private constant COOLDOWN_REDUCTION_PER_TIER = 1 days;
    uint256 private constant MIN_COOLDOWN = 2 days;
    uint256 private constant KEEPER_TIP = 10 ether;

    // ============ Immutables ============

    IERC20 public immutable julToken;
    IERC20 public immutable revenueToken;
    IReputationOracle public immutable reputationOracle;

    // ============ State ============

    uint256 private _totalStaked;
    uint256 private _totalRevenueDeposited;
    uint256 private _totalRevenueClaimed;
    uint256 public julRewardPool;

    // Synthetix accumulator
    uint256 private _rewardPerTokenStored;
    mapping(address => uint256) private _userRewardPerTokenPaid;
    mapping(address => uint256) private _rewards;

    // Staking
    mapping(address => uint256) private _stakedBalance;
    mapping(address => uint40) private _unstakeRequestTime;
    mapping(address => uint256) private _unstakeRequestAmount;

    // Revenue sources
    mapping(address => bool) private _authorizedSources;

    // ============ Constructor ============

    constructor(
        address _julToken,
        address _reputationOracle,
        address _revenueToken
    ) ERC20("VibeSwap Revenue Share", "VREV") Ownable(msg.sender) {
        if (_julToken == address(0)) revert ZeroAddress();
        if (_reputationOracle == address(0)) revert ZeroAddress();
        if (_revenueToken == address(0)) revert ZeroAddress();
        julToken = IERC20(_julToken);
        reputationOracle = IReputationOracle(_reputationOracle);
        revenueToken = IERC20(_revenueToken);
    }

    // ============ Modifiers ============

    modifier updateReward(address account) {
        _rewardPerTokenStored = _currentRewardPerToken();
        if (account != address(0)) {
            _rewards[account] = _earned(account);
            _userRewardPerTokenPaid[account] = _rewardPerTokenStored;
        }
        _;
    }

    // ============ Owner Functions ============

    /**
     * @notice Mint new VREV tokens (governance-controlled supply)
     */
    function mint(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    /**
     * @notice Burn VREV tokens (must not be staked)
     */
    function burn(address from, uint256 amount) external onlyOwner {
        if (from == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        _burn(from, amount);
        emit TokensBurned(from, amount);
    }

    /**
     * @notice Authorize or revoke a revenue source
     */
    function setRevenueSource(address source, bool authorized) external onlyOwner {
        if (source == address(0)) revert ZeroAddress();
        _authorizedSources[source] = authorized;
        emit RevenueSourceUpdated(source, authorized);
    }

    /**
     * @notice Deposit JUL into the keeper reward pool
     */
    function depositJulRewards(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        julRewardPool += amount;
        julToken.safeTransferFrom(msg.sender, address(this), amount);
        emit JulRewardsDeposited(msg.sender, amount);
    }

    // ============ Revenue Functions ============

    /**
     * @notice Deposit protocol revenue for distribution to stakers
     * @dev Only authorized sources can deposit. Revenue is distributed
     *      proportionally to all stakers via the accumulator.
     */
    function depositRevenue(uint256 amount) external nonReentrant updateReward(address(0)) {
        if (!_authorizedSources[msg.sender]) revert NotAuthorizedSource();
        if (amount == 0) revert ZeroAmount();

        _totalRevenueDeposited += amount;
        revenueToken.safeTransferFrom(msg.sender, address(this), amount);

        // Update accumulator: if no one is staked, revenue stays in contract
        // (will be distributed once someone stakes)
        if (_totalStaked > 0) {
            _rewardPerTokenStored += (amount * PRECISION) / _totalStaked;
        }

        emit RevenueDeposited(msg.sender, amount);
    }

    // ============ Staking Functions ============

    /**
     * @notice Stake VREV tokens to earn protocol revenue
     * @param amount Amount of VREV to stake
     */
    function stake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < amount) revert InsufficientBalance();

        _transfer(msg.sender, address(this), amount);
        _stakedBalance[msg.sender] += amount;
        _totalStaked += amount;

        emit Staked(msg.sender, amount);
    }

    /**
     * @notice Request to unstake tokens (starts cooldown)
     * @param amount Amount to unstake
     */
    function requestUnstake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();
        if (_stakedBalance[msg.sender] < amount) revert InsufficientStake();
        if (_unstakeRequestAmount[msg.sender] > 0) revert UnstakePending();

        _unstakeRequestTime[msg.sender] = uint40(block.timestamp);
        _unstakeRequestAmount[msg.sender] = amount;

        // Remove from staked immediately (stops earning)
        _stakedBalance[msg.sender] -= amount;
        _totalStaked -= amount;

        uint256 cooldown = _effectiveCooldown(msg.sender);
        emit UnstakeRequested(msg.sender, amount, uint40(block.timestamp + cooldown));
    }

    /**
     * @notice Complete unstaking after cooldown period
     */
    function completeUnstake() external nonReentrant {
        uint256 amount = _unstakeRequestAmount[msg.sender];
        if (amount == 0) revert NoUnstakeRequest();

        uint256 cooldown = _effectiveCooldown(msg.sender);
        if (block.timestamp < uint256(_unstakeRequestTime[msg.sender]) + cooldown) {
            revert CooldownNotElapsed();
        }

        _unstakeRequestTime[msg.sender] = 0;
        _unstakeRequestAmount[msg.sender] = 0;

        _transfer(address(this), msg.sender, amount);

        emit UnstakeCompleted(msg.sender, amount);
    }

    /**
     * @notice Cancel a pending unstake request (re-stakes tokens)
     */
    function cancelUnstake() external nonReentrant updateReward(msg.sender) {
        uint256 amount = _unstakeRequestAmount[msg.sender];
        if (amount == 0) revert NoUnstakeRequest();

        _unstakeRequestTime[msg.sender] = 0;
        _unstakeRequestAmount[msg.sender] = 0;

        // Re-stake the tokens
        _stakedBalance[msg.sender] += amount;
        _totalStaked += amount;

        emit UnstakeCancelled(msg.sender, amount);
    }

    /**
     * @notice Claim accumulated revenue
     */
    function claimRevenue() external nonReentrant updateReward(msg.sender) {
        uint256 reward = _rewards[msg.sender];
        if (reward == 0) revert NothingToClaim();

        _rewards[msg.sender] = 0;
        _totalRevenueClaimed += reward;

        revenueToken.safeTransfer(msg.sender, reward);

        emit RevenueClaimed(msg.sender, reward);
    }

    // ============ View Functions ============

    function earned(address user) external view returns (uint256) {
        return _earned(user);
    }

    function rewardPerToken() external view returns (uint256) {
        return _currentRewardPerToken();
    }

    function stakedBalanceOf(address user) external view returns (uint256) {
        return _stakedBalance[user];
    }

    function totalStaked() external view returns (uint256) {
        return _totalStaked;
    }

    function totalRevenueDeposited() external view returns (uint256) {
        return _totalRevenueDeposited;
    }

    function totalRevenueClaimed() external view returns (uint256) {
        return _totalRevenueClaimed;
    }

    function effectiveCooldown(address user) external view returns (uint256) {
        return _effectiveCooldown(user);
    }

    function cooldownRemaining(address user) external view returns (uint256) {
        if (_unstakeRequestAmount[user] == 0) return 0;
        uint256 cooldown = _effectiveCooldown(user);
        uint256 elapsed = block.timestamp - uint256(_unstakeRequestTime[user]);
        if (elapsed >= cooldown) return 0;
        return cooldown - elapsed;
    }

    function getStakeInfo(address user) external view returns (StakeInfo memory) {
        return StakeInfo({
            stakedBalance: _stakedBalance[user],
            rewardPerTokenPaid: _userRewardPerTokenPaid[user],
            pendingRewards: _earned(user),
            unstakeRequestTime: _unstakeRequestTime[user],
            unstakeRequestAmount: _unstakeRequestAmount[user]
        });
    }

    function authorizedSources(address source) external view returns (bool) {
        return _authorizedSources[source];
    }

    // ============ Internal ============

    function _currentRewardPerToken() internal view returns (uint256) {
        return _rewardPerTokenStored;
    }

    function _earned(address account) internal view returns (uint256) {
        return
            (_stakedBalance[account] *
                (_currentRewardPerToken() - _userRewardPerTokenPaid[account])) /
            PRECISION +
            _rewards[account];
    }

    /**
     * @notice Cooldown reduced by reputation tier (higher trust = faster exit)
     */
    function _effectiveCooldown(address user) internal view returns (uint256) {
        uint8 tier = reputationOracle.getTrustTier(user);
        uint256 reduction = uint256(tier) * COOLDOWN_REDUCTION_PER_TIER;
        uint256 cooldown = BASE_COOLDOWN > reduction ? BASE_COOLDOWN - reduction : 0;
        return cooldown < MIN_COOLDOWN ? MIN_COOLDOWN : cooldown;
    }
}
