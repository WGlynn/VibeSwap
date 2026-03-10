// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeLiquidStaking
 * @notice Liquid staking derivative for the VSOS DeFi operating system.
 *         Stake ETH or VIBE, receive stVIBE — a rebasing liquid staking token
 *         whose share price increases over time from protocol revenue and
 *         validator rewards.
 *
 * @dev    Part of VSOS (VibeSwap Operating System) Financial Primitives.
 *
 *         Mechanism:
 *           - Users deposit ETH/VIBE → receive stVIBE shares proportional to
 *             the current exchange rate (totalPooled / totalShares)
 *           - Oracle reports validator rewards periodically → pool grows
 *           - 5% of yield routed to insurance pool (slashing protection)
 *           - Exchange rate monotonically increases (barring slashing events)
 *
 *         Withdrawal options:
 *           1. Standard: enter withdrawal queue, 7-day unbonding → full value
 *           2. Instant: burn stVIBE immediately, pay 0.5% fee → immediate ETH
 *
 *         Co-op capitalist mechanics:
 *           - Node operators earn commission for running validators
 *           - Insurance pool mutualizes slashing risk across all stakers
 *           - No custodial key storage — validators sign independently
 *           - Transparent on-chain accounting (anyone can verify TVL)
 *
 *         UUPS upgradeable for protocol evolution.
 */
contract VibeLiquidStaking is
    Initializable,
    ERC20Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 private constant BPS = 10_000;
    uint256 private constant INSTANT_UNSTAKE_FEE_BPS = 50; // 0.5%
    uint256 private constant INSURANCE_CUT_BPS = 500; // 5% of yield
    uint256 private constant UNBONDING_PERIOD = 7 days;
    uint256 private constant MAX_OPERATOR_COMMISSION_BPS = 1_000; // 10% cap
    uint256 private constant MAX_OPERATORS = 128;
    uint256 private constant ORACLE_STALENESS = 1 days;
    uint256 private constant MAX_REWARD_INCREASE_BPS = 1_000; // 10% per report cap (sanity)
    uint256 private constant MIN_STAKE_HOLD_PERIOD = 1 days; // Anti-MEV: must hold before instant unstake

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error InsufficientShares();
    error WithdrawalNotReady();
    error WithdrawalAlreadyClaimed();
    error OperatorAlreadyRegistered();
    error OperatorNotRegistered();
    error OperatorLimitReached();
    error OperatorNotActive();
    error InvalidCommission();
    error UnauthorizedOracle();
    error StaleOracleReport();
    error RewardTooLarge();
    error InsuranceInsufficientFunds();
    error NoETHSent();
    error TransferFailed();
    error OnlyVibeMode();
    error NothingToClaim();

    // ============ Events ============

    event Staked(address indexed user, uint256 ethAmount, uint256 sharesIssued);
    event VibeStaked(address indexed user, uint256 vibeAmount, uint256 sharesIssued);
    event WithdrawalRequested(
        address indexed user, uint256 indexed requestId, uint256 shares, uint256 ethAmount
    );
    event WithdrawalClaimed(address indexed user, uint256 indexed requestId, uint256 ethAmount);
    event InstantUnstake(address indexed user, uint256 shares, uint256 ethReturned, uint256 fee);
    event RewardsReported(uint256 totalRewards, uint256 insuranceCut, uint256 netRewards);
    event OperatorAdded(address indexed operator, string name, uint16 commissionBps);
    event OperatorRemoved(address indexed operator);
    event OperatorActiveToggled(address indexed operator, bool active);
    event OperatorCommissionUpdated(address indexed operator, uint16 newCommission);
    event SlashingCovered(uint256 amount, uint256 insuranceRemaining);
    event InsuranceWithdrawn(address indexed to, uint256 amount);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);
    event VibeTokenUpdated(address indexed vibeToken);

    // ============ Structs ============

    struct WithdrawalRequest {
        address owner;
        uint128 shares;
        uint128 ethAmount;
        uint40 claimableAt;
        bool claimed;
    }

    struct NodeOperator {
        address rewardAddress;
        string name;
        uint64 validatorCount;
        uint16 commissionBps;
        bool active;
        uint256 totalRewardsEarned;
    }

    // ============ State ============

    /// @notice Total ETH (or ETH-equivalent) pooled across all stakers
    uint256 public totalPooledEther;

    /// @notice Insurance pool balance (funded by 5% of yield)
    uint256 public insurancePool;

    /// @notice Address authorized to report validator rewards
    address public oracle;

    /// @notice VIBE token for VIBE-mode staking (optional, can be address(0))
    IERC20 public vibeToken;

    /// @notice Timestamp of last oracle reward report
    uint256 public lastReportTimestamp;

    /// @notice Total VIBE staked (tracked separately for accounting)
    uint256 public totalVibeStaked;

    // Withdrawal queue
    uint256 private _nextRequestId;
    mapping(uint256 => WithdrawalRequest) private _withdrawalRequests;
    uint256 public pendingWithdrawalETH;

    // Node operators
    address[] private _operatorAddresses;
    mapping(address => NodeOperator) private _operators;
    mapping(address => bool) private _isOperator;

    // Fee accumulator for protocol treasury
    uint256 public accumulatedFees;

    // Anti-MEV: track when each user last staked (must hold MIN_STAKE_HOLD_PERIOD before instant unstake)
    mapping(address => uint256) public lastStakeTimestamp;

    /// @dev Gap for future upgrades
    uint256[39] private __gap;

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the liquid staking contract.
     * @param _oracle   Address authorized to report validator rewards.
     * @param _vibeToken VIBE token address (can be address(0) for ETH-only mode).
     */
    function initialize(address _oracle, address _vibeToken) external initializer {
        if (_oracle == address(0)) revert ZeroAddress();

        __ERC20_init("Staked VIBE", "stVIBE");
        __Ownable_init(msg.sender);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        oracle = _oracle;
        if (_vibeToken != address(0)) {
            vibeToken = IERC20(_vibeToken);
        }
        lastReportTimestamp = block.timestamp;
        _nextRequestId = 1;
    }

    // ============ Receive ============

    /// @notice Accept ETH deposits (validator rewards, direct sends)
    receive() external payable {}

    // ============ Staking ============

    /**
     * @notice Stake ETH and receive stVIBE shares.
     * @return shares The number of stVIBE shares minted.
     */
    function stake() external payable nonReentrant returns (uint256 shares) {
        if (msg.value == 0) revert NoETHSent();

        shares = _getSharesForDeposit(msg.value);
        if (shares == 0) revert ZeroAmount();

        totalPooledEther += msg.value;
        lastStakeTimestamp[msg.sender] = block.timestamp;
        _mint(msg.sender, shares);

        emit Staked(msg.sender, msg.value, shares);
    }

    /**
     * @notice Stake VIBE tokens and receive stVIBE shares.
     * @param amount The amount of VIBE to stake.
     * @return shares The number of stVIBE shares minted.
     */
    function stakeVibe(uint256 amount) external nonReentrant returns (uint256 shares) {
        if (address(vibeToken) == address(0)) revert OnlyVibeMode();
        if (amount == 0) revert ZeroAmount();

        shares = _getSharesForDeposit(amount);
        if (shares == 0) revert ZeroAmount();

        vibeToken.safeTransferFrom(msg.sender, address(this), amount);
        totalPooledEther += amount; // treat VIBE 1:1 for share accounting
        totalVibeStaked += amount;
        lastStakeTimestamp[msg.sender] = block.timestamp;
        _mint(msg.sender, shares);

        emit VibeStaked(msg.sender, amount, shares);
    }

    // ============ Withdrawal Queue ============

    /**
     * @notice Request a withdrawal. Shares are burned, ETH is claimable after unbonding.
     * @param shares Number of stVIBE shares to withdraw.
     * @return requestId The withdrawal request ID.
     */
    function requestWithdrawal(uint256 shares)
        external
        nonReentrant
        returns (uint256 requestId)
    {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < shares) revert InsufficientShares();

        uint256 ethAmount = _getPooledEthByShares(shares);

        _burn(msg.sender, shares);
        totalPooledEther -= ethAmount;
        pendingWithdrawalETH += ethAmount;

        requestId = _nextRequestId++;
        _withdrawalRequests[requestId] = WithdrawalRequest({
            owner: msg.sender,
            shares: uint128(shares),
            ethAmount: uint128(ethAmount),
            claimableAt: uint40(block.timestamp + UNBONDING_PERIOD),
            claimed: false
        });

        emit WithdrawalRequested(msg.sender, requestId, shares, ethAmount);
    }

    /**
     * @notice Claim a completed withdrawal after the unbonding period.
     * @param requestId The withdrawal request ID.
     */
    function claimWithdrawal(uint256 requestId) external nonReentrant {
        WithdrawalRequest storage req = _withdrawalRequests[requestId];
        if (req.owner != msg.sender) revert InsufficientShares();
        if (req.claimed) revert WithdrawalAlreadyClaimed();
        if (block.timestamp < req.claimableAt) revert WithdrawalNotReady();

        req.claimed = true;
        uint256 amount = req.ethAmount;
        pendingWithdrawalETH -= amount;

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit WithdrawalClaimed(msg.sender, requestId, amount);
    }

    /**
     * @notice Instantly unstake stVIBE with a 0.5% fee. No waiting period.
     * @param shares Number of stVIBE shares to burn.
     * @return ethReturned Amount of ETH returned after fee.
     */
    function instantUnstake(uint256 shares)
        external
        nonReentrant
        returns (uint256 ethReturned)
    {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < shares) revert InsufficientShares();
        // SECURITY: Anti-MEV — must hold stVIBE for minimum period before instant unstake
        // Prevents stake-before-reward → instant-unstake-after-reward yield sniping
        require(
            block.timestamp >= lastStakeTimestamp[msg.sender] + MIN_STAKE_HOLD_PERIOD,
            "Must hold stVIBE for 1 day before instant unstake"
        );

        uint256 ethAmount = _getPooledEthByShares(shares);
        uint256 fee = (ethAmount * INSTANT_UNSTAKE_FEE_BPS) / BPS;
        ethReturned = ethAmount - fee;

        _burn(msg.sender, shares);
        totalPooledEther -= ethAmount;
        accumulatedFees += fee;

        (bool ok,) = msg.sender.call{value: ethReturned}("");
        if (!ok) revert TransferFailed();

        emit InstantUnstake(msg.sender, shares, ethReturned, fee);
    }

    // ============ Oracle Rewards ============

    /**
     * @notice Report validator rewards. Only callable by the oracle.
     *         5% of yield goes to insurance pool, remainder increases share price.
     * @param rewards Total new rewards earned since last report (in wei).
     */
    function reportRewards(uint256 rewards) external {
        if (msg.sender != oracle) revert UnauthorizedOracle();
        if (rewards == 0) revert ZeroAmount();

        // Sanity check: rewards can't exceed MAX_REWARD_INCREASE_BPS of total pool
        uint256 maxReward = (totalPooledEther * MAX_REWARD_INCREASE_BPS) / BPS;
        if (rewards > maxReward && totalPooledEther > 0) revert RewardTooLarge();

        // Insurance cut
        uint256 insuranceCut = (rewards * INSURANCE_CUT_BPS) / BPS;
        uint256 netRewards = rewards - insuranceCut;

        // Distribute operator commissions
        uint256 totalCommission = _distributeOperatorCommissions(netRewards);
        uint256 stakerRewards = netRewards - totalCommission;

        // Increase the pool — share price goes up for all stVIBE holders
        totalPooledEther += stakerRewards;
        insurancePool += insuranceCut;
        lastReportTimestamp = block.timestamp;

        emit RewardsReported(rewards, insuranceCut, stakerRewards);
    }

    // ============ Node Operators ============

    /**
     * @notice Register a new node operator.
     * @param operator    Operator's reward address.
     * @param name        Human-readable name.
     * @param commission  Commission in BPS (max 10%).
     */
    function addOperator(address operator, string calldata name, uint16 commission)
        external
        onlyOwner
    {
        if (operator == address(0)) revert ZeroAddress();
        if (_isOperator[operator]) revert OperatorAlreadyRegistered();
        if (_operatorAddresses.length >= MAX_OPERATORS) revert OperatorLimitReached();
        if (commission > MAX_OPERATOR_COMMISSION_BPS) revert InvalidCommission();

        _isOperator[operator] = true;
        _operatorAddresses.push(operator);
        _operators[operator] = NodeOperator({
            rewardAddress: operator,
            name: name,
            validatorCount: 0,
            commissionBps: commission,
            active: true,
            totalRewardsEarned: 0
        });

        emit OperatorAdded(operator, name, commission);
    }

    /**
     * @notice Remove a node operator. Only owner.
     * @param operator Operator address to remove.
     */
    function removeOperator(address operator) external onlyOwner {
        if (!_isOperator[operator]) revert OperatorNotRegistered();

        _isOperator[operator] = false;
        _operators[operator].active = false;

        // Remove from array (swap-and-pop)
        uint256 len = _operatorAddresses.length;
        for (uint256 i; i < len; ++i) {
            if (_operatorAddresses[i] == operator) {
                _operatorAddresses[i] = _operatorAddresses[len - 1];
                _operatorAddresses.pop();
                break;
            }
        }

        emit OperatorRemoved(operator);
    }

    /**
     * @notice Toggle operator active status.
     * @param operator Operator address.
     * @param active   New active status.
     */
    function setOperatorActive(address operator, bool active) external onlyOwner {
        if (!_isOperator[operator]) revert OperatorNotRegistered();
        _operators[operator].active = active;
        emit OperatorActiveToggled(operator, active);
    }

    /**
     * @notice Update operator commission. Only owner.
     * @param operator      Operator address.
     * @param newCommission New commission in BPS.
     */
    function setOperatorCommission(address operator, uint16 newCommission) external onlyOwner {
        if (!_isOperator[operator]) revert OperatorNotRegistered();
        if (newCommission > MAX_OPERATOR_COMMISSION_BPS) revert InvalidCommission();
        _operators[operator].commissionBps = newCommission;
        emit OperatorCommissionUpdated(operator, newCommission);
    }

    /**
     * @notice Update validator count for an operator. Only owner.
     * @param operator Operator address.
     * @param count    New validator count.
     */
    function setValidatorCount(address operator, uint64 count) external onlyOwner {
        if (!_isOperator[operator]) revert OperatorNotRegistered();
        _operators[operator].validatorCount = count;
    }

    // ============ Insurance ============

    /**
     * @notice Cover a slashing event from the insurance pool.
     * @param amount Amount of ETH to cover from insurance.
     */
    function coverSlashing(uint256 amount) external onlyOwner {
        if (amount > insurancePool) revert InsuranceInsufficientFunds();

        insurancePool -= amount;
        totalPooledEther += amount; // restore the pool

        emit SlashingCovered(amount, insurancePool);
    }

    /**
     * @notice Withdraw excess insurance funds to a recipient. Only owner.
     * @param to     Recipient address.
     * @param amount Amount to withdraw.
     */
    function withdrawInsurance(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount > insurancePool) revert InsuranceInsufficientFunds();

        insurancePool -= amount;

        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit InsuranceWithdrawn(to, amount);
    }

    /**
     * @notice Withdraw accumulated instant-unstake fees. Only owner.
     * @param to Recipient address.
     */
    function withdrawFees(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 fees = accumulatedFees;
        if (fees == 0) revert NothingToClaim();

        accumulatedFees = 0;

        (bool ok,) = to.call{value: fees}("");
        if (!ok) revert TransferFailed();
    }

    // ============ Admin ============

    /**
     * @notice Update the oracle address. Only owner.
     * @param newOracle New oracle address.
     */
    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    /**
     * @notice Set the VIBE token address (one-time or update). Only owner.
     * @param _vibeToken VIBE token address.
     */
    function setVibeToken(address _vibeToken) external onlyOwner {
        if (_vibeToken == address(0)) revert ZeroAddress();
        vibeToken = IERC20(_vibeToken);
        emit VibeTokenUpdated(_vibeToken);
    }

    // ============ Views ============

    /**
     * @notice Get the current exchange rate: ETH per stVIBE share (scaled by 1e18).
     * @return rate The exchange rate.
     */
    function getSharePrice() external view returns (uint256 rate) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e18;
        return (totalPooledEther * 1e18) / supply;
    }

    /**
     * @notice Convert stVIBE shares to underlying ETH value.
     * @param shares Number of shares.
     * @return ethAmount Equivalent ETH value.
     */
    function getPooledEthByShares(uint256 shares) external view returns (uint256) {
        return _getPooledEthByShares(shares);
    }

    /**
     * @notice Convert ETH amount to stVIBE shares.
     * @param ethAmount Amount of ETH.
     * @return shares Equivalent shares.
     */
    function getSharesForDeposit(uint256 ethAmount) external view returns (uint256) {
        return _getSharesForDeposit(ethAmount);
    }

    /**
     * @notice Get a withdrawal request by ID.
     * @param requestId The request ID.
     */
    function getWithdrawalRequest(uint256 requestId)
        external
        view
        returns (
            address owner,
            uint128 shares,
            uint128 ethAmount,
            uint40 claimableAt,
            bool claimed
        )
    {
        WithdrawalRequest storage req = _withdrawalRequests[requestId];
        return (req.owner, req.shares, req.ethAmount, req.claimableAt, req.claimed);
    }

    /**
     * @notice Get node operator details.
     * @param operator Operator address.
     */
    function getOperator(address operator)
        external
        view
        returns (
            address rewardAddress,
            string memory name,
            uint64 validatorCount,
            uint16 commissionBps,
            bool active,
            uint256 totalRewardsEarned
        )
    {
        NodeOperator storage op = _operators[operator];
        return (
            op.rewardAddress,
            op.name,
            op.validatorCount,
            op.commissionBps,
            op.active,
            op.totalRewardsEarned
        );
    }

    /**
     * @notice Get the number of registered node operators.
     */
    function getOperatorCount() external view returns (uint256) {
        return _operatorAddresses.length;
    }

    /**
     * @notice Get operator address by index.
     * @param index Index in the operator array.
     */
    function getOperatorByIndex(uint256 index) external view returns (address) {
        return _operatorAddresses[index];
    }

    /**
     * @notice Total value locked: pooled ETH + pending withdrawals + insurance.
     */
    function totalValueLocked() external view returns (uint256) {
        return totalPooledEther + pendingWithdrawalETH + insurancePool;
    }

    /**
     * @notice Next withdrawal request ID (also = total requests created).
     */
    function nextRequestId() external view returns (uint256) {
        return _nextRequestId;
    }

    // ============ Internal ============

    /**
     * @dev Calculate shares for a given deposit amount.
     *      First deposit: 1:1 ratio. Subsequent: proportional to pool.
     */
    function _getSharesForDeposit(uint256 depositAmount) internal view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0 || totalPooledEther == 0) {
            return depositAmount;
        }
        return (depositAmount * supply) / totalPooledEther;
    }

    /**
     * @dev Calculate ETH value for a given number of shares.
     */
    function _getPooledEthByShares(uint256 shares) internal view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 0;
        return (shares * totalPooledEther) / supply;
    }

    /**
     * @dev Distribute operator commissions proportional to validator count.
     *      Returns total commission paid out.
     */
    function _distributeOperatorCommissions(uint256 netRewards)
        internal
        returns (uint256 totalCommission)
    {
        uint256 len = _operatorAddresses.length;
        if (len == 0) return 0;

        // Count total active validators
        uint256 totalValidators;
        for (uint256 i; i < len; ++i) {
            NodeOperator storage op = _operators[_operatorAddresses[i]];
            if (op.active) {
                totalValidators += op.validatorCount;
            }
        }
        if (totalValidators == 0) return 0;

        // Distribute commission proportionally
        for (uint256 i; i < len; ++i) {
            NodeOperator storage op = _operators[_operatorAddresses[i]];
            if (!op.active || op.validatorCount == 0) continue;

            // Operator's share of rewards based on validator count
            uint256 operatorShare = (netRewards * op.validatorCount) / totalValidators;
            // Commission on that share
            uint256 commission = (operatorShare * op.commissionBps) / BPS;

            op.totalRewardsEarned += commission;
            totalCommission += commission;
        }
    }

    /**
     * @dev Authorize UUPS upgrade. Only owner.
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
