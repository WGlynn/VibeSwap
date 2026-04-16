// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeFeeDistributor — Protocol Revenue Distribution
 * @notice Collects fees from all VSOS modules and distributes to stakeholders.
 *         Revenue flows: protocol fees → distribute to stakers, LPs, treasury, insurance.
 *
 * @dev Distribution splits (configurable by governance):
 *      - 40% to VIBE stakers (pro-rata)
 *      - 25% to LP providers (weighted by TVL contribution)
 *      - 20% to DAO treasury
 *      - 10% to insurance fund
 *      - 5% to ContributionDAG (mind contributors via Shapley)
 */
contract VibeFeeDistributor is OwnableUpgradeable, UUPSUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant BPS_DENOMINATOR = 10000;
    /// @notice Precision factor for Masterchef-style accPerShare math
    uint256 private constant ACC_PRECISION = 1e18;

    // ============ State ============

    /// @notice Distribution splits in basis points
    uint256 public stakerShareBps;
    uint256 public lpShareBps;
    uint256 public treasuryShareBps;
    uint256 public insuranceShareBps;
    uint256 public mindShareBps;

    /// @notice Recipient addresses
    address public treasury;
    address public insuranceFund;
    address public mindRewardPool;

    /// @notice Fee tokens that can be distributed
    mapping(address => bool) public supportedTokens;
    address[] public tokenList;

    /// @notice Accumulated fees per token (before distribution)
    mapping(address => uint256) public pendingFees;

    /// @notice Distribution epochs
    uint256 public currentEpoch;
    uint256 public epochDuration;
    uint256 public lastDistribution;

    struct EpochData {
        uint256 epochId;
        uint256 timestamp;
        uint256 totalDistributed;      // In ETH value
        mapping(address => uint256) tokenDistributed;
    }

    mapping(uint256 => EpochData) public epochs;

    /// @notice Staker claims
    mapping(address => uint256) public stakerBalance;
    mapping(address => mapping(address => uint256)) public claimableTokens; // user => token => amount

    /// @notice Total staked (for pro-rata calculation)
    uint256 public totalStaked;
    mapping(address => uint256) public userStake;

    /// @notice Masterchef: accumulated reward per unit stake, per token (scaled by ACC_PRECISION).
    ///         Bumped in _distributeToStakers. Drives lazy per-user settlement.
    mapping(address => uint256) public accPerShare;

    /// @notice Masterchef: user's reward-debt per token. Settled on stake/unstake/claim.
    ///         pending = (userStake * accPerShare[token]) / ACC_PRECISION - rewardDebt[user][token]
    mapping(address => mapping(address => uint256)) public rewardDebt;


    /// @dev Reserved storage gap for future upgrades
    /// @dev Reduced 50 -> 48 for the two new mappings above.
    uint256[48] private __gap;

    // ============ Events ============

    event FeesCollected(address indexed token, uint256 amount, address indexed source);
    event FeesDistributed(uint256 indexed epoch, address indexed token, uint256 amount);
    event StakerClaimed(address indexed staker, address indexed token, uint256 amount);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event SplitsUpdated(uint256 staker, uint256 lp, uint256 treasury, uint256 insurance, uint256 mind);
    event TokenAdded(address indexed token);

    // ============ Init ============

    function initialize(
        address _treasury,
        address _insuranceFund,
        address _mindRewardPool
    ) external initializer {
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        treasury = _treasury;
        insuranceFund = _insuranceFund;
        mindRewardPool = _mindRewardPool;

        // Default splits
        stakerShareBps = 4000;   // 40%
        lpShareBps = 2500;       // 25%
        treasuryShareBps = 2000; // 20%
        insuranceShareBps = 1000;// 10%
        mindShareBps = 500;      // 5%

        epochDuration = 7 days;
        lastDistribution = block.timestamp;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Fee Collection ============

    /**
     * @notice Collect fees from a protocol module
     * @dev Called by VSOS modules when they generate revenue
     */
    function collectFees(address token, uint256 amount) external {
        require(supportedTokens[token], "Token not supported");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        pendingFees[token] += amount;
        emit FeesCollected(token, amount, msg.sender);
    }

    /**
     * @notice Collect ETH fees
     */
    function collectETHFees() external payable {
        pendingFees[address(0)] += msg.value;
        emit FeesCollected(address(0), msg.value, msg.sender);
    }

    // ============ Distribution ============

    /**
     * @notice Distribute all pending fees for a token
     */
    function distribute(address token) external nonReentrant {
        require(block.timestamp >= lastDistribution + epochDuration, "Epoch not ended");

        uint256 amount = pendingFees[token];
        require(amount > 0, "No fees to distribute");

        pendingFees[token] = 0;
        currentEpoch++;
        lastDistribution = block.timestamp;

        uint256 stakerAmount = (amount * stakerShareBps) / BPS_DENOMINATOR;
        uint256 lpAmount = (amount * lpShareBps) / BPS_DENOMINATOR;
        uint256 treasuryAmount = (amount * treasuryShareBps) / BPS_DENOMINATOR;
        uint256 insuranceAmount = (amount * insuranceShareBps) / BPS_DENOMINATOR;
        uint256 mindAmount = amount - stakerAmount - lpAmount - treasuryAmount - insuranceAmount;

        // Staker portion goes to claim pool (pro-rata based on stake)
        // Users claim their share individually
        if (totalStaked > 0 && stakerAmount > 0) {
            // Record per-staker claimable amounts
            _distributeToStakers(token, stakerAmount);
        }

        // Direct transfers to other pools
        if (token == address(0)) {
            if (treasuryAmount > 0) { (bool ok1, ) = treasury.call{value: treasuryAmount}(""); require(ok1); }
            if (insuranceAmount > 0) { (bool ok2, ) = insuranceFund.call{value: insuranceAmount}(""); require(ok2); }
            if (mindAmount > 0) { (bool ok3, ) = mindRewardPool.call{value: mindAmount}(""); require(ok3); }
            // LP amount stays in contract for LP claiming (similar to staker)
        } else {
            if (treasuryAmount > 0) IERC20(token).safeTransfer(treasury, treasuryAmount);
            if (insuranceAmount > 0) IERC20(token).safeTransfer(insuranceFund, insuranceAmount);
            if (mindAmount > 0) IERC20(token).safeTransfer(mindRewardPool, mindAmount);
        }

        EpochData storage epoch = epochs[currentEpoch];
        epoch.epochId = currentEpoch;
        epoch.timestamp = block.timestamp;
        epoch.totalDistributed += amount;
        epoch.tokenDistributed[token] = amount;

        emit FeesDistributed(currentEpoch, token, amount);
    }

    // ============ Staking ============

    /**
     * @notice Stake VIBE to earn protocol revenue
     */
    function stake() external payable nonReentrant {
        require(msg.value > 0, "Zero stake");
        // Settle prior-period rewards at the OLD stake level before the bump,
        // then record new debt at the new stake level.
        _settleAllTokens(msg.sender);
        userStake[msg.sender] += msg.value;
        totalStaked += msg.value;
        _rebaseDebtAllTokens(msg.sender);
        emit Staked(msg.sender, msg.value);
    }

    /**
     * @notice Unstake VIBE
     */
    function unstake(uint256 amount) external nonReentrant {
        require(userStake[msg.sender] >= amount, "Insufficient stake");
        // Settle at the OLD stake level before the reduction.
        _settleAllTokens(msg.sender);
        userStake[msg.sender] -= amount;
        totalStaked -= amount;
        _rebaseDebtAllTokens(msg.sender);
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        emit Unstaked(msg.sender, amount);
    }

    /// @dev After userStake changes, re-baseline rewardDebt for every token so
    ///      future accrual starts from the current accPerShare snapshot.
    function _rebaseDebtAllTokens(address user) internal {
        rewardDebt[user][address(0)] = (userStake[user] * accPerShare[address(0)]) / ACC_PRECISION;
        uint256 n = tokenList.length;
        for (uint256 i = 0; i < n; ) {
            address t = tokenList[i];
            rewardDebt[user][t] = (userStake[user] * accPerShare[t]) / ACC_PRECISION;
            unchecked { ++i; }
        }
    }

    /**
     * @notice Claim accumulated fee rewards
     */
    function claim(address token) external nonReentrant {
        // Fold freshly-accrued pending into claimableTokens before reading.
        _settleOne(msg.sender, token);

        uint256 amount = claimableTokens[msg.sender][token];
        require(amount > 0, "Nothing to claim");
        claimableTokens[msg.sender][token] = 0;

        if (token == address(0)) {
            (bool ok, ) = msg.sender.call{value: amount}("");
            require(ok, "Transfer failed");
        } else {
            IERC20(token).safeTransfer(msg.sender, amount);
        }

        emit StakerClaimed(msg.sender, token, amount);
    }

    // ============ Admin ============

    function addSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = true;
        tokenList.push(token);
        emit TokenAdded(token);
    }

    function updateSplits(
        uint256 _staker,
        uint256 _lp,
        uint256 _treasury,
        uint256 _insurance,
        uint256 _mind
    ) external onlyOwner {
        require(_staker + _lp + _treasury + _insurance + _mind == BPS_DENOMINATOR, "Must sum to 10000");
        stakerShareBps = _staker;
        lpShareBps = _lp;
        treasuryShareBps = _treasury;
        insuranceShareBps = _insurance;
        mindShareBps = _mind;
        emit SplitsUpdated(_staker, _lp, _treasury, _insurance, _mind);
    }

    // ============ Internal ============

    /// @dev Masterchef-style accumulator. O(1) regardless of staker count.
    ///      Users settle lazily via claim() or on stake/unstake via _settleAllTokens.
    ///      Previously this was an empty stub — stakers' share was silently lost.
    function _distributeToStakers(address token, uint256 amount) internal {
        // Guard at call-site: distribute() only calls us when totalStaked > 0.
        accPerShare[token] += (amount * ACC_PRECISION) / totalStaked;
    }

    /// @dev Compute pending claimable for a specific token using current userStake.
    function _pending(address user, address token) internal view returns (uint256) {
        uint256 stake_ = userStake[user];
        if (stake_ == 0) return 0;
        uint256 accumulated = (stake_ * accPerShare[token]) / ACC_PRECISION;
        uint256 debt = rewardDebt[user][token];
        return accumulated > debt ? accumulated - debt : 0;
    }

    /// @dev Settle a single token: move pending into claimableTokens and reset debt.
    function _settleOne(address user, address token) internal {
        uint256 pending = _pending(user, token);
        if (pending > 0) {
            claimableTokens[user][token] += pending;
        }
        rewardDebt[user][token] = (userStake[user] * accPerShare[token]) / ACC_PRECISION;
    }

    /// @dev Settle every supported token plus native ETH. Called before any
    ///      userStake change — otherwise a stake bump would over-credit prior
    ///      distributions (and a stake reduction would under-credit). O(n_tokens).
    function _settleAllTokens(address user) internal {
        _settleOne(user, address(0));
        uint256 n = tokenList.length;
        for (uint256 i = 0; i < n; ) {
            _settleOne(user, tokenList[i]);
            unchecked { ++i; }
        }
    }

    // ============ View ============

    function getClaimable(address user, address token) external view returns (uint256) {
        return claimableTokens[user][token] + _pending(user, token);
    }

    function getSupportedTokens() external view returns (address[] memory) {
        return tokenList;
    }

    /// @notice Receive ETH
    receive() external payable {}
}
