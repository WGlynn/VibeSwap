// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ICommitRevealAuction.sol";
import "./interfaces/IVibeAMM.sol";
import "./interfaces/IDAOTreasury.sol";
import "./CircuitBreaker.sol";
import "../messaging/CrossChainRouter.sol";
import "../libraries/SecurityLib.sol";

/**
 * @title VibeSwapCore
 * @notice Main entry point for VibeSwap omnichain DEX
 * @dev Orchestrates commit-reveal auction, AMM, treasury, and cross-chain operations
 *      Includes comprehensive security features and rate limiting
 */
contract VibeSwapCore is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Structs ============

    struct SwapParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        bytes32 secret;
        uint256 priorityBid;
    }

    struct PoolInfo {
        bytes32 poolId;
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 spotPrice;
        uint256 feeRate;
    }

    // ============ State ============

    /// @notice CommitRevealAuction contract
    ICommitRevealAuction public auction;

    /// @notice VibeAMM contract
    IVibeAMM public amm;

    /// @notice DAOTreasury contract
    IDAOTreasury public treasury;

    /// @notice CrossChainRouter contract
    CrossChainRouter public router;

    /// @notice Supported tokens
    mapping(address => bool) public supportedTokens;

    /// @notice Token deposits for pending orders
    mapping(address => mapping(address => uint256)) public deposits;

    /// @notice Commit ID to swap params (for execution)
    mapping(bytes32 => SwapParams) public pendingSwaps;

    /// @notice Paused state
    bool public paused;

    // ============ Security State ============

    /// @notice Rate limit per user per hour
    mapping(address => SecurityLib.RateLimit) public userRateLimits;

    /// @notice Maximum swap amount per hour per user (default 100k tokens)
    uint256 public maxSwapPerHour;

    /// @notice Blacklisted addresses (known exploit contracts)
    mapping(address => bool) public blacklisted;

    /// @notice Whitelisted contracts (can interact)
    mapping(address => bool) public whitelistedContracts;

    /// @notice Whether to enforce EOA-only for commits (flash loan protection)
    bool public requireEOA;

    /// @notice Minimum time between commits for same user
    uint256 public commitCooldown;

    /// @notice Last commit timestamp per user
    mapping(address => uint256) public lastCommitTime;

    /// @notice Emergency guardian who can pause
    address public guardian;

    // ============ Events ============

    event SwapCommitted(
        bytes32 indexed commitId,
        address indexed trader,
        uint64 indexed batchId
    );

    event SwapRevealed(
        bytes32 indexed commitId,
        address indexed trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    );

    event SwapExecuted(
        bytes32 indexed commitId,
        address indexed trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    event BatchProcessed(
        uint64 indexed batchId,
        uint256 orderCount,
        uint256 totalVolume,
        uint256 clearingPrice
    );

    event TokenSupported(address indexed token, bool supported);
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event UserBlacklisted(address indexed user, bool status);
    event ContractWhitelisted(address indexed contractAddr, bool status);
    event RateLimitExceeded(address indexed user, uint256 requested, uint256 limit);
    event GuardianUpdated(address indexed oldGuardian, address indexed newGuardian);

    // ============ Errors ============

    error ContractPaused();
    error UnsupportedToken();
    error InsufficientDeposit();
    error InvalidPhase();
    error SwapFailed();
    error Blacklisted();
    error RateLimitExceededError();
    error NotEOA();
    error CommitCooldownActive();
    error NotGuardian();

    // ============ Modifiers ============

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier onlySupported(address token) {
        if (!supportedTokens[token]) revert UnsupportedToken();
        _;
    }

    modifier notBlacklisted() {
        if (blacklisted[msg.sender]) revert Blacklisted();
        _;
    }

    modifier onlyEOAOrWhitelisted() {
        if (requireEOA) {
            // Allow EOAs or whitelisted contracts
            if (msg.sender != tx.origin && !whitelistedContracts[msg.sender]) {
                revert NotEOA();
            }
        }
        _;
    }

    modifier onlyGuardianOrOwner() {
        if (msg.sender != guardian && msg.sender != owner()) revert NotGuardian();
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
     * @param _auction CommitRevealAuction address
     * @param _amm VibeAMM address
     * @param _treasury DAOTreasury address
     * @param _router CrossChainRouter address
     */
    function initialize(
        address _owner,
        address _auction,
        address _amm,
        address _treasury,
        address _router
    ) external initializer {
        require(_owner != address(0), "Invalid owner");
        require(_auction != address(0), "Invalid auction");
        require(_amm != address(0), "Invalid amm");
        require(_treasury != address(0), "Invalid treasury");
        require(_router != address(0), "Invalid router");

        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        auction = ICommitRevealAuction(_auction);
        amm = IVibeAMM(_amm);
        treasury = IDAOTreasury(_treasury);
        router = CrossChainRouter(payable(_router));

        // Security defaults
        maxSwapPerHour = 100_000 * 1e18; // 100k tokens
        requireEOA = true; // Enable flash loan protection
        commitCooldown = 1; // 1 second minimum between commits
        guardian = _owner;
    }

    // ============ User Functions ============

    /**
     * @notice Commit a swap order for the current batch
     * @param tokenIn Token to sell
     * @param tokenOut Token to buy
     * @param amountIn Amount to sell
     * @param minAmountOut Minimum amount to receive
     * @param secret Random secret for commitment
     * @return commitId Unique commitment ID
     */
    function commitSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 secret
    ) external payable whenNotPaused nonReentrant notBlacklisted onlyEOAOrWhitelisted
      onlySupported(tokenIn) onlySupported(tokenOut) returns (bytes32 commitId) {
        require(amountIn > 0, "Zero amount");
        require(tokenIn != tokenOut, "Same token");

        // Commit cooldown check (anti-spam)
        if (commitCooldown > 0) {
            if (block.timestamp < lastCommitTime[msg.sender] + commitCooldown) {
                revert CommitCooldownActive();
            }
            lastCommitTime[msg.sender] = block.timestamp;
        }

        // Rate limit check
        _checkAndUpdateRateLimit(msg.sender, amountIn);

        // Generate commitment hash
        bytes32 commitHash = keccak256(abi.encodePacked(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            secret
        ));

        // Deposit tokens
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        deposits[msg.sender][tokenIn] += amountIn;

        // Submit to auction
        commitId = auction.commitOrder{value: msg.value}(commitHash);

        // Store swap params for reveal
        pendingSwaps[commitId] = SwapParams({
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountIn: amountIn,
            minAmountOut: minAmountOut,
            secret: secret,
            priorityBid: 0
        });

        // Track ownership for reveal verification
        commitOwners[commitId] = msg.sender;

        emit SwapCommitted(commitId, msg.sender, auction.getCurrentBatchId());
    }

    /// @notice Mapping of commitId to original committer
    mapping(bytes32 => address) public commitOwners;

    /**
     * @notice Reveal a previously committed swap
     * @param commitId Commitment ID
     * @param priorityBid Priority bid for execution order
     */
    function revealSwap(
        bytes32 commitId,
        uint256 priorityBid
    ) external payable whenNotPaused nonReentrant {
        SwapParams storage params = pendingSwaps[commitId];
        require(params.amountIn > 0, "Invalid commit");

        // Verify ownership - only original committer can reveal
        require(commitOwners[commitId] == msg.sender, "Not commit owner");

        // Update priority bid
        params.priorityBid = priorityBid;

        // Reveal to auction - use cross-chain variant since we're acting on behalf of user
        // This passes the original trader address for hash verification
        auction.revealOrderCrossChain{value: msg.value}(
            commitId,
            msg.sender, // Original trader (commit owner)
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            params.minAmountOut,
            params.secret,
            priorityBid
        );

        emit SwapRevealed(
            commitId,
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            params.amountIn
        );
    }

    /**
     * @notice Process and settle a batch
     * @param batchId Batch ID to settle (must match current batch)
     */
    function settleBatch(uint64 batchId) external whenNotPaused nonReentrant {
        // Verify we're settling the correct batch
        uint64 currentBatchId = auction.getCurrentBatchId();
        require(batchId == currentBatchId, "Wrong batch ID");

        // Advance phase if needed
        auction.advancePhase();

        // Settle the batch
        auction.settleBatch();

        // Get revealed orders for the settled batch
        // Note: After settleBatch(), a new batch is created, so we need to use batchId we passed in
        ICommitRevealAuction.RevealedOrder[] memory orders = auction.getRevealedOrders(batchId);

        if (orders.length == 0) {
            emit BatchProcessed(batchId, 0, 0, 0);
            return;
        }

        // Get execution order (priority first, then shuffled)
        uint256[] memory executionOrder = auction.getExecutionOrder(batchId);

        // Execute orders
        _executeOrders(batchId, orders, executionOrder);
    }

    /**
     * @notice Withdraw deposit for a failed/cancelled order
     * @param token Token to withdraw
     */
    function withdrawDeposit(address token) external nonReentrant {
        uint256 amount = deposits[msg.sender][token];
        require(amount > 0, "No deposit");

        deposits[msg.sender][token] = 0;
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    // ============ Cross-Chain Functions ============

    /**
     * @notice Submit cross-chain swap commitment
     * @param dstChainId Destination chain ID
     * @param tokenIn Local token to sell
     * @param tokenOut Token to receive on destination
     * @param amountIn Amount to sell
     * @param minAmountOut Minimum to receive
     * @param secret Commitment secret
     * @param options LayerZero options
     */
    function commitCrossChainSwap(
        uint32 dstChainId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes32 secret,
        bytes calldata options
    ) external payable whenNotPaused nonReentrant onlySupported(tokenIn) {
        // Deposit tokens
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        deposits[msg.sender][tokenIn] += amountIn;

        // Generate commitment hash
        bytes32 commitHash = keccak256(abi.encodePacked(
            msg.sender,
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            secret
        ));

        // Send via router
        router.sendCommit{value: msg.value}(dstChainId, commitHash, options);
    }

    // ============ View Functions ============

    /**
     * @notice Get current batch info
     */
    function getCurrentBatch() external view returns (
        uint64 batchId,
        ICommitRevealAuction.BatchPhase phase,
        uint256 timeUntilPhaseChange
    ) {
        batchId = auction.getCurrentBatchId();
        phase = auction.getCurrentPhase();
        // Use auction's canonical time calculation (references protocol constants)
        timeUntilPhaseChange = auction.getTimeUntilPhaseChange();
    }

    /**
     * @notice Get pool info for a token pair
     */
    function getPoolInfo(
        address tokenA,
        address tokenB
    ) external view returns (PoolInfo memory info) {
        info.poolId = amm.getPoolId(tokenA, tokenB);
        IVibeAMM.Pool memory pool = amm.getPool(info.poolId);

        info.token0 = pool.token0;
        info.token1 = pool.token1;
        info.reserve0 = pool.reserve0;
        info.reserve1 = pool.reserve1;
        info.feeRate = pool.feeRate;

        if (pool.reserve0 > 0) {
            info.spotPrice = (pool.reserve1 * 1e18) / pool.reserve0;
        }
    }

    /**
     * @notice Get quote for a swap
     */
    function getQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut) {
        bytes32 poolId = amm.getPoolId(tokenIn, tokenOut);
        return amm.quote(poolId, tokenIn, amountIn);
    }

    /**
     * @notice Get user's pending deposit
     */
    function getDeposit(
        address user,
        address token
    ) external view returns (uint256) {
        return deposits[user][token];
    }

    // ============ Admin Functions ============

    /**
     * @notice Create a new liquidity pool
     */
    function createPool(
        address token0,
        address token1,
        uint256 feeRate
    ) external onlyOwner returns (bytes32 poolId) {
        poolId = amm.createPool(token0, token1, feeRate);

        // Auto-support tokens
        supportedTokens[token0] = true;
        supportedTokens[token1] = true;

        emit TokenSupported(token0, true);
        emit TokenSupported(token1, true);
    }

    /**
     * @notice Set token support status
     */
    function setSupportedToken(
        address token,
        bool supported
    ) external onlyOwner {
        supportedTokens[token] = supported;
        emit TokenSupported(token, supported);
    }

    /**
     * @notice Pause the contract
     */
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /**
     * @notice Update subsystem contracts
     */
    function updateContracts(
        address _auction,
        address _amm,
        address _treasury,
        address _router
    ) external onlyOwner {
        if (_auction != address(0)) auction = ICommitRevealAuction(_auction);
        if (_amm != address(0)) amm = IVibeAMM(_amm);
        if (_treasury != address(0)) treasury = IDAOTreasury(_treasury);
        if (_router != address(0)) router = CrossChainRouter(payable(_router));
    }

    // ============ Internal Functions ============

    /**
     * @notice Execute orders in batch
     */
    function _executeOrders(
        uint64 batchId,
        ICommitRevealAuction.RevealedOrder[] memory orders,
        uint256[] memory executionOrder
    ) internal {
        uint256 totalVolume = 0;
        uint256 lastClearingPrice = 0;

        // Group by pool and execute batch swaps
        // Simplified: execute each order individually for now
        for (uint256 i = 0; i < executionOrder.length; i++) {
            uint256 idx = executionOrder[i];
            ICommitRevealAuction.RevealedOrder memory order = orders[idx];

            // Verify we have the deposit
            uint256 userDeposit = deposits[order.trader][order.tokenIn];
            if (userDeposit < order.amountIn) {
                // Skip orders without sufficient deposit
                continue;
            }

            bytes32 poolId = amm.getPoolId(order.tokenIn, order.tokenOut);

            // Transfer tokens to AMM before swap
            IERC20(order.tokenIn).safeTransfer(address(amm), order.amountIn);

            // Prepare swap order
            IVibeAMM.SwapOrder[] memory swapOrders = new IVibeAMM.SwapOrder[](1);
            swapOrders[0] = IVibeAMM.SwapOrder({
                trader: order.trader,
                tokenIn: order.tokenIn,
                tokenOut: order.tokenOut,
                amountIn: order.amountIn,
                minAmountOut: order.minAmountOut,
                isPriority: order.priorityBid > 0
            });

            // Execute batch swap
            IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(
                poolId,
                batchId,
                swapOrders
            );

            // Only clear deposit if swap was executed
            if (result.totalTokenInSwapped > 0) {
                totalVolume += result.totalTokenInSwapped;
                lastClearingPrice = result.clearingPrice;
                deposits[order.trader][order.tokenIn] -= order.amountIn;
            } else {
                // Swap failed, return tokens to this contract (they're still here since AMM didn't take them)
                // Note: AMM should return unfilled tokens, but currently doesn't - this is a simplified model
            }
        }

        // Send priority bids to treasury (only what we actually have)
        ICommitRevealAuction.Batch memory batch = auction.getBatch(batchId);
        if (batch.totalPriorityBids > 0 && address(this).balance >= batch.totalPriorityBids) {
            treasury.receiveAuctionProceeds{value: batch.totalPriorityBids}(batchId);
        }

        emit BatchProcessed(batchId, orders.length, totalVolume, lastClearingPrice);
    }

    /**
     * @notice Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    // ============ Security Internal Functions ============

    /**
     * @notice Check and update rate limit for user
     */
    function _checkAndUpdateRateLimit(address user, uint256 amount) internal {
        SecurityLib.RateLimit memory limit = userRateLimits[user];

        // Initialize if first interaction
        if (limit.windowDuration == 0) {
            limit.windowStart = block.timestamp;
            limit.windowDuration = 1 hours;
            limit.maxAmount = maxSwapPerHour;
            limit.usedAmount = 0;
        }

        (bool allowed, uint256 newUsedAmount) = SecurityLib.checkRateLimit(limit, amount);

        if (!allowed) {
            emit RateLimitExceeded(user, amount, limit.maxAmount);
            revert RateLimitExceededError();
        }

        // Update state
        if (block.timestamp >= limit.windowStart + limit.windowDuration) {
            // New window
            userRateLimits[user] = SecurityLib.RateLimit({
                windowStart: block.timestamp,
                windowDuration: 1 hours,
                maxAmount: maxSwapPerHour,
                usedAmount: amount
            });
        } else {
            userRateLimits[user].usedAmount = newUsedAmount;
        }
    }

    // ============ Security Admin Functions ============

    /**
     * @notice Set blacklist status for an address
     */
    function setBlacklist(address user, bool status) external onlyOwner {
        blacklisted[user] = status;
        emit UserBlacklisted(user, status);
    }

    /**
     * @notice Batch blacklist addresses (for known exploit contracts)
     */
    function batchBlacklist(address[] calldata users, bool status) external onlyOwner {
        for (uint256 i = 0; i < users.length; i++) {
            blacklisted[users[i]] = status;
            emit UserBlacklisted(users[i], status);
        }
    }

    /**
     * @notice Set whitelist status for a contract
     */
    function setContractWhitelist(address contractAddr, bool status) external onlyOwner {
        whitelistedContracts[contractAddr] = status;
        emit ContractWhitelisted(contractAddr, status);
    }

    /**
     * @notice Set maximum swap amount per hour
     */
    function setMaxSwapPerHour(uint256 amount) external onlyOwner {
        maxSwapPerHour = amount;
    }

    /**
     * @notice Set EOA requirement (flash loan protection)
     */
    function setRequireEOA(bool required) external onlyOwner {
        requireEOA = required;
    }

    /**
     * @notice Set commit cooldown
     */
    function setCommitCooldown(uint256 cooldown) external onlyOwner {
        commitCooldown = cooldown;
    }

    /**
     * @notice Set guardian address
     */
    function setGuardian(address newGuardian) external onlyOwner {
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    /**
     * @notice Emergency pause (guardian or owner)
     */
    function emergencyPause() external onlyGuardianOrOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @notice Get user's rate limit status
     */
    function getUserRateLimit(address user) external view returns (
        uint256 windowStart,
        uint256 usedAmount,
        uint256 maxAmount,
        uint256 remainingAmount
    ) {
        SecurityLib.RateLimit memory limit = userRateLimits[user];
        windowStart = limit.windowStart;
        usedAmount = limit.usedAmount;
        maxAmount = limit.maxAmount > 0 ? limit.maxAmount : maxSwapPerHour;

        // Check if window expired
        if (block.timestamp >= limit.windowStart + limit.windowDuration) {
            usedAmount = 0;
        }

        remainingAmount = maxAmount > usedAmount ? maxAmount - usedAmount : 0;
    }

    // ============ Receive ============

    receive() external payable {}
}
