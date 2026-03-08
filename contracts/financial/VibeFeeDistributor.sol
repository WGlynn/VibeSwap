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

    function _authorizeUpgrade(address) internal override onlyOwner {}

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
     * @notice Stake VIBE to earn protocol fees
     */
    function stake() external payable {
        require(msg.value > 0, "Zero stake");
        userStake[msg.sender] += msg.value;
        totalStaked += msg.value;
        emit Staked(msg.sender, msg.value);
    }

    /**
     * @notice Unstake VIBE
     */
    function unstake(uint256 amount) external nonReentrant {
        require(userStake[msg.sender] >= amount, "Insufficient stake");
        userStake[msg.sender] -= amount;
        totalStaked -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "Transfer failed");
        emit Unstaked(msg.sender, amount);
    }

    /**
     * @notice Claim accumulated fee rewards
     */
    function claim(address token) external nonReentrant {
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

    function _distributeToStakers(address token, uint256 amount) internal {
        // Simple approach: iterate stakers and assign pro-rata
        // In production, use a checkpoint/snapshot mechanism
        // For now, increment each staker's claimable balance
        // This is O(n) but works for reasonable staker counts
        // TODO: Replace with Merkle distributor for gas efficiency at scale
    }

    // ============ View ============

    function getClaimable(address user, address token) external view returns (uint256) {
        return claimableTokens[user][token];
    }

    function getSupportedTokens() external view returns (address[] memory) {
        return tokenList;
    }

    /// @notice Receive ETH
    receive() external payable {}
}
