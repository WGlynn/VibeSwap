// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../core/interfaces/IDAOTreasury.sol";
import "../core/interfaces/IVibeAMM.sol";

/**
 * @title DAOTreasury
 * @notice DAO treasury with backstop liquidity and timelock-controlled withdrawals
 * @dev Receives protocol fees and auction proceeds, provides price smoothing for store-of-value assets
 */
contract DAOTreasury is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    IDAOTreasury
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Minimum timelock duration (1 hour) - prevents instant withdrawals
    uint256 public constant MIN_TIMELOCK = 1 hours;

    /// @notice Default timelock duration (2 days)
    uint256 public constant DEFAULT_TIMELOCK = 2 days;

    /// @notice Maximum timelock duration (30 days)
    uint256 public constant MAX_TIMELOCK = 30 days;

    /// @notice Precision for price calculations
    uint256 public constant PRECISION = 1e18;

    // ============ State ============

    /// @notice Current timelock duration
    uint256 public timelockDuration;

    /// @notice Next withdrawal request ID
    uint256 public nextRequestId;

    /// @notice VibeAMM contract
    address public vibeAMM;

    /// @notice Authorized fee senders
    mapping(address => bool) public authorizedFeeSenders;

    /// @notice Backstop configurations per token
    mapping(address => BackstopConfig) public backstopConfigs;

    /// @notice Withdrawal requests
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;

    /// @notice Total received fees per token
    mapping(address => uint256) public totalFeesReceived;

    /// @notice Total received auction proceeds
    uint256 public totalAuctionProceeds;

    /// @notice LP positions held by treasury (poolId => amount)
    mapping(bytes32 => uint256) public lpPositions;

    /// @notice Authorized backstop operators (e.g. TreasuryStabilizer)
    mapping(address => bool) public backstopOperators;

    /// @notice Emergency timelock (shorter than normal, but still prevents instant drain)
    uint256 public constant EMERGENCY_TIMELOCK = 6 hours;

    /// @notice Emergency guardian (optional co-signer for emergency withdrawals)
    address public emergencyGuardian;

    /// @notice Pending emergency withdrawal requests
    struct EmergencyRequest {
        address token;
        address recipient;
        uint256 amount;
        uint256 executeAfter;
        bool executed;
        bool cancelled;
        bool guardianApproved;
    }
    mapping(uint256 => EmergencyRequest) public emergencyRequests;
    uint256 public nextEmergencyId;

    // ============ Modifiers ============

    modifier onlyAuthorizedFeeSender() {
        require(authorizedFeeSenders[msg.sender], "Not authorized");
        _;
    }

    modifier onlyOwnerOrBackstopOperator() {
        require(msg.sender == owner() || backstopOperators[msg.sender], "Not authorized");
        _;
    }

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param _owner Owner address
     * @param _vibeAMM VibeAMM contract address
     */
    function initialize(
        address _owner,
        address _vibeAMM
    ) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();

        require(_vibeAMM != address(0), "Invalid AMM");
        vibeAMM = _vibeAMM;
        timelockDuration = DEFAULT_TIMELOCK;
        nextRequestId = 1;
    }

    // ============ External Functions ============

    /**
     * @notice Receive protocol fees from AMM
     * @param token Token address
     * @param amount Fee amount
     * @param batchId Batch that generated fees
     */
    function receiveProtocolFees(
        address token,
        uint256 amount,
        uint64 batchId
    ) external onlyAuthorizedFeeSender nonReentrant {
        require(amount > 0, "Zero amount");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        totalFeesReceived[token] += amount;

        // Update backstop reserve if configured
        BackstopConfig storage config = backstopConfigs[token];
        if (config.isActive) {
            config.currentReserve += amount;
        }

        emit ProtocolFeesReceived(token, amount, batchId);
    }

    /**
     * @notice Receive auction proceeds (priority bid payments)
     * @param batchId Batch that generated proceeds
     */
    function receiveAuctionProceeds(uint64 batchId) external payable {
        require(authorizedFeeSenders[msg.sender] || msg.sender == owner(), "Not authorized");
        require(msg.value > 0, "Zero amount");

        totalAuctionProceeds += msg.value;

        emit AuctionProceedsReceived(msg.value, batchId);
    }

    /**
     * @notice Configure backstop for a token
     * @param token Token to backstop
     * @param targetReserve Target reserve amount
     * @param smoothingFactor EMA smoothing factor (1e18 scale)
     * @param isStoreOfValue Whether token is a store of value asset
     */
    function configureBackstop(
        address token,
        uint256 targetReserve,
        uint256 smoothingFactor,
        bool isStoreOfValue
    ) external onlyOwner {
        require(token != address(0), "Invalid token");
        require(smoothingFactor <= PRECISION, "Invalid smoothing factor");

        backstopConfigs[token] = BackstopConfig({
            token: token,
            targetReserve: targetReserve,
            currentReserve: backstopConfigs[token].currentReserve,
            smoothingFactor: smoothingFactor,
            lastPrice: backstopConfigs[token].lastPrice,
            isStoreOfValue: isStoreOfValue,
            isActive: true
        });

        emit BackstopConfigured(token, targetReserve, smoothingFactor, isStoreOfValue);
    }

    /**
     * @notice Provide backstop liquidity to AMM pool
     * @param poolId Pool to provide liquidity to
     * @param token0Amount Amount of token0
     * @param token1Amount Amount of token1
     */
    function provideBackstopLiquidity(
        bytes32 poolId,
        uint256 token0Amount,
        uint256 token1Amount
    ) external onlyOwnerOrBackstopOperator nonReentrant {
        IVibeAMM amm = IVibeAMM(vibeAMM);
        IVibeAMM.Pool memory pool = amm.getPool(poolId);

        require(pool.initialized, "Pool not found");

        // Approve tokens
        IERC20(pool.token0).safeIncreaseAllowance(vibeAMM, token0Amount);
        IERC20(pool.token1).safeIncreaseAllowance(vibeAMM, token1Amount);

        // Add liquidity with 95% slippage protection against sandwich attacks
        uint256 minToken0 = (token0Amount * 95) / 100;
        uint256 minToken1 = (token1Amount * 95) / 100;

        (,, uint256 liquidity) = amm.addLiquidity(
            poolId,
            token0Amount,
            token1Amount,
            minToken0,
            minToken1
        );

        lpPositions[poolId] += liquidity;

        emit BackstopLiquidityProvided(pool.token0, token0Amount, poolId);
        emit BackstopLiquidityProvided(pool.token1, token1Amount, poolId);
    }

    /**
     * @notice Remove backstop liquidity from AMM pool
     * @param poolId Pool to remove liquidity from
     * @param lpAmount LP tokens to burn
     * @return received Total token value received
     */
    function removeBackstopLiquidity(
        bytes32 poolId,
        uint256 lpAmount,
        uint256 minAmount0,
        uint256 minAmount1
    ) external onlyOwnerOrBackstopOperator nonReentrant returns (uint256 received) {
        IVibeAMM amm = IVibeAMM(vibeAMM);
        (uint256 amount0, uint256 amount1) = amm.removeLiquidity(
            poolId,
            lpAmount,
            minAmount0,
            minAmount1
        );
        lpPositions[poolId] -= lpAmount;
        received = amount0 + amount1;
    }

    /**
     * @notice Queue a withdrawal (timelock)
     * @param recipient Address to receive funds
     * @param token Token to withdraw (address(0) for ETH)
     * @param amount Amount to withdraw
     * @return requestId Withdrawal request ID
     */
    function queueWithdrawal(
        address recipient,
        address token,
        uint256 amount
    ) external onlyOwner returns (uint256 requestId) {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Zero amount");

        // Verify balance
        if (token == address(0)) {
            require(address(this).balance >= amount, "Insufficient ETH");
        } else {
            require(IERC20(token).balanceOf(address(this)) >= amount, "Insufficient balance");
        }

        requestId = nextRequestId++;
        uint256 executeAfter = block.timestamp + timelockDuration;

        withdrawalRequests[requestId] = WithdrawalRequest({
            recipient: recipient,
            token: token,
            amount: amount,
            executeAfter: executeAfter,
            executed: false,
            cancelled: false
        });

        emit WithdrawalQueued(requestId, recipient, token, amount, executeAfter);
    }

    /**
     * @notice Execute a queued withdrawal after timelock
     * @param requestId Withdrawal request ID
     */
    function executeWithdrawal(uint256 requestId) external nonReentrant {
        WithdrawalRequest storage request = withdrawalRequests[requestId];

        require(!request.executed, "Already executed");
        require(!request.cancelled, "Cancelled");
        require(block.timestamp >= request.executeAfter, "Timelock active");
        require(request.amount > 0, "Invalid request");

        request.executed = true;

        if (request.token == address(0)) {
            // ETH withdrawal
            (bool success, ) = request.recipient.call{value: request.amount}("");
            require(success, "ETH transfer failed");
        } else {
            // Token withdrawal
            IERC20(request.token).safeTransfer(request.recipient, request.amount);
        }

        emit WithdrawalExecuted(requestId, request.recipient, request.token, request.amount);
    }

    /**
     * @notice Cancel a pending withdrawal
     * @param requestId Withdrawal request ID
     */
    function cancelWithdrawal(uint256 requestId) external onlyOwner {
        WithdrawalRequest storage request = withdrawalRequests[requestId];

        require(!request.executed, "Already executed");
        require(!request.cancelled, "Already cancelled");

        request.cancelled = true;

        emit WithdrawalCancelled(requestId);
    }

    /**
     * @notice Calculate smoothed price for backstop
     * @param token Token address
     * @param currentPrice Current market price
     * @return smoothedPrice EMA-smoothed price
     */
    function calculateSmoothedPrice(
        address token,
        uint256 currentPrice
    ) external view returns (uint256 smoothedPrice) {
        BackstopConfig storage config = backstopConfigs[token];

        if (!config.isActive || config.lastPrice == 0) {
            return currentPrice;
        }

        // EMA: smoothedPrice = α * currentPrice + (1 - α) * lastPrice
        // where α = smoothingFactor
        uint256 alpha = config.smoothingFactor;
        smoothedPrice = (alpha * currentPrice + (PRECISION - alpha) * config.lastPrice) / PRECISION;
    }

    /**
     * @notice Update smoothed price (called during swaps)
     * @param token Token address
     * @param currentPrice Current market price
     */
    function updateSmoothedPrice(
        address token,
        uint256 currentPrice
    ) external onlyAuthorizedFeeSender {
        BackstopConfig storage config = backstopConfigs[token];

        if (!config.isActive) return;

        uint256 smoothedPrice;
        if (config.lastPrice == 0) {
            smoothedPrice = currentPrice;
        } else {
            uint256 alpha = config.smoothingFactor;
            smoothedPrice = (alpha * currentPrice + (PRECISION - alpha) * config.lastPrice) / PRECISION;
        }

        config.lastPrice = smoothedPrice;

        emit PriceSmoothed(token, currentPrice, smoothedPrice);
    }

    // ============ View Functions ============

    /**
     * @notice Get backstop configuration
     */
    function getBackstopConfig(address token) external view returns (BackstopConfig memory) {
        return backstopConfigs[token];
    }

    /**
     * @notice Get withdrawal request details
     */
    function getWithdrawalRequest(uint256 requestId) external view returns (WithdrawalRequest memory) {
        return withdrawalRequests[requestId];
    }

    /**
     * @notice Get treasury balance for a token
     */
    function getBalance(address token) external view returns (uint256) {
        if (token == address(0)) {
            return address(this).balance;
        }
        return IERC20(token).balanceOf(address(this));
    }

    /**
     * @notice Check if backstop has sufficient reserves
     * @param token Token to check
     * @return sufficient Whether reserves meet target
     * @return deficit Amount below target (0 if sufficient)
     */
    function checkBackstopReserves(address token) external view returns (
        bool sufficient,
        uint256 deficit
    ) {
        BackstopConfig storage config = backstopConfigs[token];

        if (!config.isActive) {
            return (true, 0);
        }

        if (config.currentReserve >= config.targetReserve) {
            return (true, 0);
        }

        return (false, config.targetReserve - config.currentReserve);
    }

    // ============ Admin Functions ============

    /**
     * @notice Set authorized fee sender
     */
    function setAuthorizedFeeSender(
        address sender,
        bool authorized
    ) external onlyOwner {
        authorizedFeeSenders[sender] = authorized;
        emit AuthorizedFeeSenderUpdated(sender, authorized);
    }

    /**
     * @notice Update timelock duration
     */
    function setTimelockDuration(uint256 duration) external onlyOwner {
        require(duration >= MIN_TIMELOCK, "Below minimum");
        require(duration <= MAX_TIMELOCK, "Exceeds maximum");
        timelockDuration = duration;
        emit TimelockDurationUpdated(duration);
    }

    /**
     * @notice Update VibeAMM address
     */
    function setVibeAMM(address _vibeAMM) external onlyOwner {
        require(_vibeAMM != address(0), "Invalid AMM");
        vibeAMM = _vibeAMM;
        emit VibeAMMUpdated(_vibeAMM);
    }

    /**
     * @notice Set authorized backstop operator (e.g. TreasuryStabilizer)
     */
    function setBackstopOperator(address operator, bool authorized) external onlyOwner {
        require(operator != address(0), "Invalid operator");
        backstopOperators[operator] = authorized;
        emit BackstopOperatorUpdated(operator, authorized);
    }

    /**
     * @notice Deactivate backstop for token
     */
    function deactivateBackstop(address token) external onlyOwner {
        backstopConfigs[token].isActive = false;
        emit BackstopDeactivated(token);
    }

    // ============ Emergency Withdrawal (Governed) ============

    event EmergencyWithdrawalQueued(uint256 indexed emergencyId, address token, address recipient, uint256 amount, uint256 executeAfter);
    event EmergencyWithdrawalExecuted(uint256 indexed emergencyId, address token, address recipient, uint256 amount);
    event EmergencyWithdrawalCancelled(uint256 indexed emergencyId);
    event EmergencyGuardianApproved(uint256 indexed emergencyId);
    event EmergencyGuardianSet(address indexed guardian);
    event AuthorizedFeeSenderUpdated(address indexed sender, bool authorized);
    event TimelockDurationUpdated(uint256 duration);
    event VibeAMMUpdated(address indexed amm);
    event BackstopOperatorUpdated(address indexed operator, bool authorized);
    event BackstopDeactivated(address indexed token);

    /**
     * @notice Queue an emergency withdrawal (6-hour timelock)
     * @dev Shorter than normal timelock but still provides governance window
     */
    function queueEmergencyWithdraw(
        address token,
        address recipient,
        uint256 amount
    ) external onlyOwner returns (uint256 emergencyId) {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Zero amount");

        emergencyId = nextEmergencyId++;
        uint256 executeAfter = block.timestamp + EMERGENCY_TIMELOCK;

        emergencyRequests[emergencyId] = EmergencyRequest({
            token: token,
            recipient: recipient,
            amount: amount,
            executeAfter: executeAfter,
            executed: false,
            cancelled: false,
            guardianApproved: emergencyGuardian == address(0) // auto-approved if no guardian set
        });

        emit EmergencyWithdrawalQueued(emergencyId, token, recipient, amount, executeAfter);
    }

    /**
     * @notice Emergency guardian approves a pending emergency withdrawal
     */
    function approveEmergencyWithdraw(uint256 emergencyId) external {
        require(msg.sender == emergencyGuardian, "Not emergency guardian");

        EmergencyRequest storage req = emergencyRequests[emergencyId];
        require(!req.executed && !req.cancelled, "Request closed");

        req.guardianApproved = true;
        emit EmergencyGuardianApproved(emergencyId);
    }

    /**
     * @notice Execute emergency withdrawal after timelock + guardian approval
     */
    function executeEmergencyWithdraw(uint256 emergencyId) external onlyOwner nonReentrant {
        EmergencyRequest storage req = emergencyRequests[emergencyId];
        require(!req.executed, "Already executed");
        require(!req.cancelled, "Cancelled");
        require(block.timestamp >= req.executeAfter, "Emergency timelock active");
        require(req.guardianApproved, "Guardian approval required");
        require(req.amount > 0, "Invalid request");

        req.executed = true;

        if (req.token == address(0)) {
            (bool success, ) = req.recipient.call{value: req.amount}("");
            require(success, "ETH transfer failed");
        } else {
            IERC20(req.token).safeTransfer(req.recipient, req.amount);
        }

        emit EmergencyWithdrawalExecuted(emergencyId, req.token, req.recipient, req.amount);
    }

    /**
     * @notice Cancel a pending emergency withdrawal
     */
    function cancelEmergencyWithdraw(uint256 emergencyId) external onlyOwner {
        EmergencyRequest storage req = emergencyRequests[emergencyId];
        require(!req.executed, "Already executed");
        require(!req.cancelled, "Already cancelled");

        req.cancelled = true;
        emit EmergencyWithdrawalCancelled(emergencyId);
    }

    /**
     * @notice Set emergency guardian (optional co-signer for emergency withdrawals)
     * @param guardian Address of guardian (address(0) to disable)
     */
    function setEmergencyGuardian(address guardian) external onlyOwner {
        emergencyGuardian = guardian;
        emit EmergencyGuardianSet(guardian);
    }

    // ============ Receive ============

    receive() external payable {}
}
