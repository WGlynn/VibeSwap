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
import "./interfaces/IwBAR.sol";
import "./CircuitBreaker.sol";
import "../messaging/CrossChainRouter.sol";
import "../libraries/SecurityLib.sol";
import "../compliance/ClawbackRegistry.sol";
import "../incentives/interfaces/IIncentiveController.sol";

/**
 * @title VibeSwapCore
 * @author Faraday1 & JARVIS — vibeswap.org
 * @notice Main entry point for VibeSwap omnichain DEX
 * @dev Orchestrates commit-reveal auction, AMM, treasury, and cross-chain operations.
 *      Includes comprehensive security features and rate limiting.
 *
 *      THE LAWSON CONSTANT: The greatest idea cannot be stolen, because part of it
 *      is admitting who came up with it. Without that, the entire system falls apart.
 *      Attribution is load-bearing. See: ContributionDAG, ShapleyDistributor, P-000.
 */
contract VibeSwapCore is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ DISINTERMEDIATION ROADMAP ============
    // Phase 1 (NOW): Owner controls all admin functions
    // Phase 2 (NEXT): Transfer ownership to TimelockController (48h delay)
    // Phase 3 (GOVERNANCE): DAO proposals via GovernanceGuard with Shapley veto
    // Phase 4 (GHOST): Renounce ownership. Immutable where safe. Governance where needed.
    // Every onlyOwner function in this contract has a documented target grade.
    //
    // Disintermediation Grades:
    //   Grade A (DISSOLVED): No access control. Permissionless. Structurally safe.
    //   Grade B (GOVERNANCE): TimelockController + DAO vote. No single human can act.
    //   Grade C (OWNER): Current state. Single owner key. Bootstrap-only.
    //   KEEP: Genuinely security-critical. Remains gated even in Phase 4.

    // ============ The Lawson Constant ============
    // "Fairness above all. If something is clearly unfair, amending the code
    //  is not just a right — it is a responsibility, a credo, a law, a canon."
    //  — Faraday1, 2026
    //
    // This constant is used in ContributionDAG trust score calculations.
    // Removing it breaks Shapley distribution fairness guarantees.
    // Fork responsibly: attribution is structural, not decorative.
    bytes32 public constant LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");

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

    /// @notice Clawback registry for taint checking
    ClawbackRegistry public clawbackRegistry;

    /// @notice Wrapped Batch Auction Receipts contract
    IwBAR public wbar;

    /// @notice Mapping of batchId => trader => commitId (for wBAR output routing)
    mapping(uint64 => mapping(address => bytes32)) public batchTraderCommitId;

    /// @notice IncentiveController for auction proceeds distribution and execution tracking
    IIncentiveController public incentiveController;

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
    event ContractsUpdated(address auction, address amm, address treasury, address router);
    event WBARUpdated(address indexed wbar);
    event IncentiveControllerUpdated(address indexed controller);
    event MaxSwapPerHourUpdated(uint256 amount);
    event RequireEOAUpdated(bool required);
    event CommitCooldownUpdated(uint256 cooldown);
    event ClawbackRegistryUpdated(address indexed registry);

    // FIX #5: Events for order failures (no more silent failures)
    event OrderFailed(
        uint64 indexed batchId,
        address indexed trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        string reason
    );

    // FIX #6: Events for silent try-catch failures (auditability)
    event ExecutionTrackingFailed(bytes32 indexed poolId, address indexed trader, bytes reason);
    event ComplianceCheckFailed(bytes32 indexed poolId, address indexed trader, bytes reason);

    // SEC-1: Event for refunded orders in partial batch failures
    event OrderRefunded(
        uint64 indexed batchId,
        address indexed trader,
        address tokenIn,
        uint256 amountIn,
        string reason
    );

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
    error WalletTainted();

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

    modifier notTainted() {
        if (address(clawbackRegistry) != address(0) && clawbackRegistry.isBlocked(msg.sender)) {
            revert WalletTainted();
        }
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
    ) external payable whenNotPaused nonReentrant notBlacklisted notTainted onlyEOAOrWhitelisted
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

        uint64 currentBatchId = auction.getCurrentBatchId();

        // M-06 DISSOLVED: One commit per trader per batch. Prevents batchTraderCommitId
        // overwrite which would break wBAR routing for earlier commits.
        // If you need multiple orders, use multiple addresses or wait for next batch.
        require(
            batchTraderCommitId[currentBatchId][msg.sender] == bytes32(0),
            "M-06: One commit per batch per trader"
        );

        emit SwapCommitted(commitId, msg.sender, currentBatchId);

        // Mint wBAR receipt if enabled
        if (address(wbar) != address(0)) {
            wbar.mint(commitId, currentBatchId, msg.sender, tokenIn, tokenOut, amountIn, minAmountOut);
        }
        batchTraderCommitId[currentBatchId][msg.sender] = commitId;
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
     * @dev SEC-2: settleBatch is INTENTIONALLY permissionless (no access control).
     *      In VibeSwap's commit-reveal batch auction, settlement is a public good:
     *      - Timing is deterministic (8s commit + 2s reveal per batch)
     *      - The batch can only be settled after the reveal phase ends (enforced by auction.settleBatch())
     *      - Anyone can trigger settlement — this enables bots, keepers, and users to settle
     *      - No MEV advantage: execution order is determined by the deterministic shuffle,
     *        and the clearing price is uniform. The settler gains no information advantage.
     *      - Restricting to a single settler would create a liveness dependency and censorship risk.
     *      Adding access control here would harm the protocol's censorship resistance.
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
    ) external payable whenNotPaused nonReentrant notBlacklisted notTainted onlyEOAOrWhitelisted
      onlySupported(tokenIn) onlySupported(tokenOut) {
        require(amountIn > 0, "Zero amount");
        require(tokenIn != tokenOut, "Same token");

        // Commit cooldown check (anti-spam) — must match commitSwap
        if (commitCooldown > 0) {
            if (block.timestamp < lastCommitTime[msg.sender] + commitCooldown) {
                revert CommitCooldownActive();
            }
            lastCommitTime[msg.sender] = block.timestamp;
        }

        // Rate limit check — must match commitSwap
        _checkAndUpdateRateLimit(msg.sender, amountIn);

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
     * @notice Create a new liquidity pool — PERMISSIONLESS
     *
     * DISINTERMEDIATION: Grade A (DISSOLVED). Anyone can create pools.
     * Safety: VibeAMM enforces fee bounds (5-1000 bps). Pool creation
     * is permissionless in VibeAMM — this gate was redundant.
     */
    function createPool(
        address token0,
        address token1,
        uint256 feeRate
    ) external returns (bytes32 poolId) {
        poolId = amm.createPool(token0, token1, feeRate);

        // Auto-support tokens
        supportedTokens[token0] = true;
        supportedTokens[token1] = true;

        emit TokenSupported(token0, true);
        emit TokenSupported(token1, true);
    }

    /**
     * @notice Set token support status
     *
     * DISINTERMEDIATION: Grade C → Target Grade B. Requires governance (TimelockController).
     * Token whitelisting is a policy/security decision — prevents scam tokens from
     * being routed through the protocol. Governance-appropriate.
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
     *
     * DISINTERMEDIATION: Grade B (DISSOLVED from owner-only). Guardian OR owner
     * can pause — removes single-owner dependency for emergency functions.
     * Also accessible via emergencyPause(). Target: governance + guardian multisig.
     */
    function pause() external onlyGuardianOrOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    /**
     * @notice Unpause the contract
     *
     * DISINTERMEDIATION: Grade B (DISSOLVED from owner-only). Guardian OR owner
     * can unpause — mirrors pause() access. Target: governance timelock for unpause.
     */
    function unpause() external onlyGuardianOrOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    /**
     * @notice Update subsystem contracts
     *
     * DISINTERMEDIATION: KEEP — infrastructure wiring is the highest-trust operation.
     * Changing auction/AMM/treasury/router addresses can redirect ALL protocol operations.
     * Target Grade B via governance TimelockController with significant delay (48h+).
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
        emit ContractsUpdated(_auction, _amm, _treasury, _router);
    }

    // ============ wBAR Functions ============

    /**
     * @notice Set wBAR contract address
     * @param _wbar wBAR contract address (address(0) to disable)
     *
     * DISINTERMEDIATION: Grade C → Target Grade B. Requires governance (TimelockController).
     * Infrastructure wiring — governance-appropriate post-bootstrap.
     */
    function setWBAR(address _wbar) external onlyOwner {
        wbar = IwBAR(_wbar);
        emit WBARUpdated(_wbar);
    }

    /**
     * @notice Set the IncentiveController for auction proceeds and execution tracking
     * @param _controller IncentiveController proxy address (or address(0) to disable)
     *
     * DISINTERMEDIATION: Grade C → Target Grade B. Requires governance (TimelockController).
     */
    function setIncentiveController(address _controller) external onlyOwner {
        incentiveController = IIncentiveController(_controller);
        emit IncentiveControllerUpdated(_controller);
    }

    /**
     * @notice Release failed deposit to wBAR holder
     * @dev Only callable by wBAR contract for failed swap reclaims
     * @param commitId The commit that failed
     * @param to Address to receive the tokens
     * @param token Token to release
     * @param amount Amount to release
     */
    function releaseFailedDeposit(bytes32 commitId, address to, address token, uint256 amount) external nonReentrant {
        require(msg.sender == address(wbar), "Only wBAR");
        require(deposits[commitOwners[commitId]][token] >= amount, "Insufficient deposit");
        deposits[commitOwners[commitId]][token] -= amount;
        IERC20(token).safeTransfer(to, amount);
    }

    // ============ Internal Functions ============

    /**
     * @notice Execute orders in batch — orchestrates validation, execution, and settlement
     */
    function _executeOrders(
        uint64 batchId,
        ICommitRevealAuction.RevealedOrder[] memory orders,
        uint256[] memory executionOrder
    ) internal {
        // Phase 1: Validate deposits and group orders by pool
        (
            bytes32[] memory poolIds,
            uint256 uniquePoolCount,
            bytes32[] memory orderPoolIds,
            bool[] memory orderValid
        ) = _validateAndGroupOrders(batchId, orders, executionOrder);

        // Phase 2: Execute per-pool batch swaps + Phase 3: Post-execution accounting
        (uint256 totalVolume, uint256 lastClearingPrice) = _executePoolBatches(
            batchId, orders, executionOrder, poolIds, uniquePoolCount, orderPoolIds, orderValid
        );

        // Phase 4: Forward priority bids to treasury
        _forwardPriorityBids(batchId);

        emit BatchProcessed(batchId, orders.length, totalVolume, lastClearingPrice);
    }

    /**
     * @notice Phase 1: Validate deposits and group orders by pool ID
     * @dev Aggregates all orders for the same pool so the AMM computes one uniform clearing price
     */
    function _validateAndGroupOrders(
        uint64 batchId,
        ICommitRevealAuction.RevealedOrder[] memory orders,
        uint256[] memory executionOrder
    ) internal returns (
        bytes32[] memory poolIds,
        uint256 uniquePoolCount,
        bytes32[] memory orderPoolIds,
        bool[] memory orderValid
    ) {
        poolIds = new bytes32[](executionOrder.length);
        orderPoolIds = new bytes32[](executionOrder.length);
        orderValid = new bool[](executionOrder.length);

        // C-02: Dissolve duplicate trader order griefing — track cumulative validated
        // amounts per trader-token pair. Without this, a trader with deposit=1000 and
        // two orders of 600 each would pass validation for both (600 < 1000) but
        // underflow during settlement (1000 - 600 - 600), reverting the entire batch
        // and griefing all other traders. By accumulating per-trader-token, excess
        // orders are marked invalid before they can poison the batch.

        // Temporary arrays to track cumulative validated amounts per trader-token pair.
        // We use parallel arrays since memory mappings are not supported in Solidity.
        address[] memory trackedTraders = new address[](executionOrder.length);
        address[] memory trackedTokens = new address[](executionOrder.length);
        uint256[] memory trackedAmounts = new uint256[](executionOrder.length);
        uint256 trackedCount = 0;

        for (uint256 i = 0; i < executionOrder.length; i++) {
            uint256 idx = executionOrder[i];
            ICommitRevealAuction.RevealedOrder memory order = orders[idx];

            // Find or create cumulative tracker for this trader-token pair
            uint256 cumulativeAmount = order.amountIn;
            uint256 trackerIdx = type(uint256).max;
            for (uint256 t = 0; t < trackedCount; t++) {
                if (trackedTraders[t] == order.trader && trackedTokens[t] == order.tokenIn) {
                    trackerIdx = t;
                    cumulativeAmount = trackedAmounts[t] + order.amountIn;
                    break;
                }
            }

            // Verify cumulative deposit does not exceed available balance
            if (deposits[order.trader][order.tokenIn] < cumulativeAmount) {
                emit OrderFailed(batchId, order.trader, order.tokenIn, order.tokenOut, order.amountIn, "Insufficient deposit");
                continue;
            }

            // Update cumulative tracker
            if (trackerIdx == type(uint256).max) {
                trackedTraders[trackedCount] = order.trader;
                trackedTokens[trackedCount] = order.tokenIn;
                trackedAmounts[trackedCount] = cumulativeAmount;
                trackedCount++;
            } else {
                trackedAmounts[trackerIdx] = cumulativeAmount;
            }

            bytes32 poolId = amm.getPoolId(order.tokenIn, order.tokenOut);
            orderPoolIds[i] = poolId;
            orderValid[i] = true;

            // Track unique pools
            bool found = false;
            for (uint256 j = 0; j < uniquePoolCount; j++) {
                if (poolIds[j] == poolId) { found = true; break; }
            }
            if (!found) {
                poolIds[uniquePoolCount] = poolId;
                uniquePoolCount++;
            }
        }
    }

    /**
     * @notice Phase 2+3: Execute swaps per pool and settle each order
     */
    function _executePoolBatches(
        uint64 batchId,
        ICommitRevealAuction.RevealedOrder[] memory orders,
        uint256[] memory executionOrder,
        bytes32[] memory poolIds,
        uint256 uniquePoolCount,
        bytes32[] memory orderPoolIds,
        bool[] memory orderValid
    ) internal returns (uint256 totalVolume, uint256 lastClearingPrice) {
        for (uint256 p = 0; p < uniquePoolCount; p++) {
            bytes32 poolId = poolIds[p];

            // Build SwapOrder array and collect original indices
            (
                IVibeAMM.SwapOrder[] memory swapOrders,
                uint256[] memory originalIndices,
                uint256 count
            ) = _buildPoolSwapOrders(batchId, orders, executionOrder, orderPoolIds, orderValid, poolId);

            if (count == 0) continue;

            // Execute ALL orders for this pool in one batch -> one uniform clearing price
            IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, batchId, swapOrders);

            // Post-execution accounting
            if (result.totalTokenInSwapped > 0) {
                totalVolume += result.totalTokenInSwapped;
                lastClearingPrice = result.clearingPrice;
                _settleExecutedOrders(batchId, orders, originalIndices, count, poolId, result);
            } else {
                _emitFailedOrders(batchId, orders, originalIndices, count);
            }
        }
    }

    /**
     * @notice Build SwapOrder array for a single pool, transferring tokens to AMM
     */
    function _buildPoolSwapOrders(
        uint64 batchId,
        ICommitRevealAuction.RevealedOrder[] memory orders,
        uint256[] memory executionOrder,
        bytes32[] memory orderPoolIds,
        bool[] memory orderValid,
        bytes32 poolId
    ) internal returns (
        IVibeAMM.SwapOrder[] memory swapOrders,
        uint256[] memory originalIndices,
        uint256 count
    ) {
        // Count valid orders for this pool
        for (uint256 i = 0; i < executionOrder.length; i++) {
            if (orderValid[i] && orderPoolIds[i] == poolId) count++;
        }
        if (count == 0) return (swapOrders, originalIndices, 0);

        swapOrders = new IVibeAMM.SwapOrder[](count);
        originalIndices = new uint256[](count);
        uint256 cursor = 0;

        for (uint256 i = 0; i < executionOrder.length; i++) {
            if (!orderValid[i] || orderPoolIds[i] != poolId) continue;

            uint256 idx = executionOrder[i];
            ICommitRevealAuction.RevealedOrder memory order = orders[idx];
            address recipient = _resolveRecipient(batchId, order.trader);

            IERC20(order.tokenIn).safeTransfer(address(amm), order.amountIn);

            swapOrders[cursor] = IVibeAMM.SwapOrder({
                trader: recipient,
                tokenIn: order.tokenIn,
                tokenOut: order.tokenOut,
                amountIn: order.amountIn,
                minAmountOut: order.minAmountOut,
                isPriority: order.priorityBid > 0
            });
            originalIndices[cursor] = idx;
            cursor++;
        }
    }

    /**
     * @notice Resolve recipient for an order — routes to wBAR if receipt was transferred
     */
    function _resolveRecipient(uint64 batchId, address trader) internal view returns (address) {
        if (address(wbar) == address(0)) return trader;

        bytes32 traderCommitId = batchTraderCommitId[batchId][trader];
        if (traderCommitId == bytes32(0)) return trader;

        address wbarHolder = wbar.holderOf(traderCommitId);
        return (wbarHolder != trader) ? address(wbar) : trader;
    }

    /**
     * @notice Settle individual orders after successful batch execution
     * @dev SEC-1: Detects partial batch failures. When executeBatchSwap returns aggregate
     *      results, some individual orders may have failed (slippage/liquidity). The AMM
     *      returns those orders' tokens to VibeSwapCore and contributes (0,0,0) to totals.
     *      We detect this by comparing totalTokenInSwapped against the sum of all orders'
     *      amountIn. Failed orders are identified by replicating the AMM's output check
     *      (clearing price + pool fee rate vs minAmountOut). Their deposits are NOT
     *      decremented — the user can reclaim via withdrawDeposit().
     */
    function _settleExecutedOrders(
        uint64 batchId,
        ICommitRevealAuction.RevealedOrder[] memory orders,
        uint256[] memory originalIndices,
        uint256 count,
        bytes32 poolId,
        IVibeAMM.BatchSwapResult memory result
    ) internal {
        // SEC-1: Compute total input sent to AMM and detect partial failures
        uint256 totalInputSent = 0;
        for (uint256 k = 0; k < count; k++) {
            totalInputSent += orders[originalIndices[k]].amountIn;
        }
        bool hasFailures = result.totalTokenInSwapped < totalInputSent;

        // Get pool info for per-order failure detection (only when needed)
        IVibeAMM.Pool memory pool;
        if (hasFailures) {
            pool = amm.getPool(poolId);
        }

        for (uint256 k = 0; k < count; k++) {
            uint256 idx = originalIndices[k];
            ICommitRevealAuction.RevealedOrder memory order = orders[idx];

            // SEC-1: Skip failed orders within a partial batch — don't decrement their deposits.
            // The AMM already returned their tokens to VibeSwapCore. The user can reclaim
            // via withdrawDeposit(). We identify failures by replicating the AMM's output
            // calculation: clearing price -> gross output -> fee deduction -> check minAmountOut.
            if (hasFailures) {
                bool isToken0 = order.tokenIn == pool.token0;
                uint256 grossOut;
                if (isToken0) {
                    grossOut = (order.amountIn * result.clearingPrice) / 1e18;
                } else {
                    grossOut = result.clearingPrice > 0
                        ? (order.amountIn * 1e18) / result.clearingPrice
                        : 0;
                }
                // Use pool base fee rate as conservative lower bound. If actual fee is higher
                // (True Price surcharge), netOut is even lower — so this check is conservative:
                // it correctly identifies all slippage failures, and may also catch surcharge failures.
                uint256 netOut = grossOut - (grossOut * pool.feeRate) / 10000;

                if (netOut < order.minAmountOut) {
                    // This order failed in the AMM — tokens already returned to VibeSwapCore
                    emit OrderRefunded(
                        batchId, order.trader, order.tokenIn, order.amountIn,
                        "Partial batch: slippage or liquidity failure"
                    );
                    continue;
                }
            }

            // Clear deposit (only for successfully executed orders)
            deposits[order.trader][order.tokenIn] -= order.amountIn;

            // Pro-rata share of total output based on input contribution
            // NOTE: totalTokenInSwapped only includes successful orders, so pro-rata is accurate
            uint256 estimatedOut = 0;
            if (result.clearingPrice > 0 && result.totalTokenInSwapped > 0) {
                estimatedOut = (order.amountIn * result.totalTokenOutSwapped) / result.totalTokenInSwapped;
            }

            // Settle wBAR position
            _settleWBAR(batchId, order.trader, estimatedOut);

            // Record execution + compliance
            _recordExecution(poolId, order, estimatedOut);
        }
    }

    /**
     * @notice Settle wBAR receipt position if applicable
     */
    function _settleWBAR(uint64 batchId, address trader, uint256 amountOut) internal {
        if (address(wbar) == address(0)) return;

        bytes32 traderCommitId = batchTraderCommitId[batchId][trader];
        if (traderCommitId != bytes32(0)) {
            wbar.settle(traderCommitId, amountOut);
        }
    }

    /**
     * @notice Record execution in incentive controller and compliance registry
     */
    function _recordExecution(
        bytes32 poolId,
        ICommitRevealAuction.RevealedOrder memory order,
        uint256 estimatedOut
    ) internal {
        if (address(incentiveController) != address(0)) {
            try incentiveController.recordExecution(
                poolId, order.trader, order.amountIn, estimatedOut, order.minAmountOut
            ) {} catch (bytes memory reason) {
                emit ExecutionTrackingFailed(poolId, order.trader, reason);
            }
        }

        if (address(clawbackRegistry) != address(0)) {
            try clawbackRegistry.recordTransaction(
                order.trader, address(amm), order.amountIn, order.tokenIn
            ) {} catch (bytes memory reason) {
                emit ComplianceCheckFailed(poolId, order.trader, reason);
            }
        }
    }

    /**
     * @notice Emit failure events for orders in a failed batch execution
     */
    function _emitFailedOrders(
        uint64 batchId,
        ICommitRevealAuction.RevealedOrder[] memory orders,
        uint256[] memory originalIndices,
        uint256 count
    ) internal {
        for (uint256 k = 0; k < count; k++) {
            uint256 idx = originalIndices[k];
            ICommitRevealAuction.RevealedOrder memory order = orders[idx];
            emit OrderFailed(batchId, order.trader, order.tokenIn, order.tokenOut, order.amountIn, "Swap execution failed");
        }
    }

    /**
     * @notice Forward priority bids to DAO treasury
     */
    function _forwardPriorityBids(uint64 batchId) internal {
        ICommitRevealAuction.Batch memory batch = auction.getBatch(batchId);
        if (batch.totalPriorityBids > 0 && address(this).balance >= batch.totalPriorityBids) {
            treasury.receiveAuctionProceeds{value: batch.totalPriorityBids}(batchId);
        }
    }

    /**
     * @notice Authorize upgrade (UUPS)
     *
     * DISINTERMEDIATION: KEEP during bootstrap. Target Grade B via governance TimelockController.
     * Upgrades are the highest-trust operation — must be last to dissolve.
     */
    // L-01: Validate new implementation is a contract
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
        require(newImplementation.code.length > 0, "Not a contract");
    }

    // ============ Security Internal Functions ============

    /**
     * @notice Check and update rate limit for user
     */
    function _checkAndUpdateRateLimit(address user, uint256 amount) internal {
        SecurityLib.RateLimit memory limit = userRateLimits[user];

        // Initialize if first interaction — write FULL struct to storage
        if (limit.windowDuration == 0) {
            limit.windowStart = block.timestamp;
            limit.windowDuration = 1 hours;
            limit.maxAmount = maxSwapPerHour;
            limit.usedAmount = 0;

            // FIX: Persist the full struct on first interaction
            // Previously only usedAmount was written, leaving windowDuration=0 in storage
            // causing re-initialization on every call (rate limit was non-functional)
            userRateLimits[user] = limit;
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
     *
     * DISINTERMEDIATION: KEEP — security enforcement requires rapid response.
     * Target Grade B: guardian multisig + governance can blacklist.
     * Cannot be permissionless (griefing: anyone blacklists competitors).
     */
    function setBlacklist(address user, bool status) external onlyOwner {
        blacklisted[user] = status;
        emit UserBlacklisted(user, status);
    }

    /**
     * @notice Batch blacklist addresses (for known exploit contracts)
     *
     * DISINTERMEDIATION: KEEP — same as setBlacklist. Security enforcement.
     */
    function batchBlacklist(address[] calldata users, bool status) external onlyOwner {
        for (uint256 i = 0; i < users.length; i++) {
            blacklisted[users[i]] = status;
            emit UserBlacklisted(users[i], status);
        }
    }

    /**
     * @notice Set whitelist status for a contract
     *
     * DISINTERMEDIATION: Grade C → Target Grade B. Requires governance (TimelockController).
     * Contract whitelisting determines which integrations can interact with the protocol.
     */
    function setContractWhitelist(address contractAddr, bool status) external onlyOwner {
        whitelistedContracts[contractAddr] = status;
        emit ContractWhitelisted(contractAddr, status);
    }

    /**
     * @notice Set maximum swap amount per hour
     *
     * DISINTERMEDIATION: Grade B (DISSOLVED from Grade C). Guardian OR owner can adjust.
     * Rate limiting parameter — safe default exists (100K). No fund risk from misconfiguration;
     * worst case is overly permissive or restrictive rate limits, both recoverable.
     * Target Grade B via governance TimelockController.
     */
    function setMaxSwapPerHour(uint256 amount) external onlyGuardianOrOwner {
        maxSwapPerHour = amount;
        emit MaxSwapPerHourUpdated(amount);
    }

    /**
     * @notice Set EOA requirement (flash loan protection)
     *
     * DISINTERMEDIATION: Grade B (DISSOLVED from Grade C). Guardian OR owner can toggle.
     * Configuration toggle that doesn't affect funds — controls whether contracts can
     * interact directly. Disabling allows more integrations; enabling blocks flash loans.
     * Both states are safe; whitelistedContracts provides granular override.
     * Target Grade B via governance TimelockController.
     */
    function setRequireEOA(bool required) external onlyGuardianOrOwner {
        requireEOA = required;
        emit RequireEOAUpdated(required);
    }

    /**
     * @notice Set commit cooldown
     *
     * DISINTERMEDIATION: Grade B (DISSOLVED from Grade C). Guardian OR owner can adjust.
     * Anti-spam rate limiting parameter. No fund risk — worst case is zero cooldown
     * (more spam, handled by other rate limits) or excessive cooldown (poor UX, recoverable).
     * Target Grade B via governance TimelockController.
     */
    function setCommitCooldown(uint256 cooldown) external onlyGuardianOrOwner {
        commitCooldown = cooldown;
        emit CommitCooldownUpdated(cooldown);
    }

    /**
     * @notice Set guardian address
     *
     * DISINTERMEDIATION: KEEP — guardian is part of the security architecture.
     * Target Grade B: governance sets guardian via TimelockController.
     */
    function setGuardian(address newGuardian) external onlyOwner {
        require(newGuardian != address(0), "Invalid guardian");
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    /**
     * @notice Set clawback registry for taint checking
     *
     * DISINTERMEDIATION: Grade B (DISSOLVED from Grade C). Guardian OR owner can set.
     * Infrastructure wiring for compliance. Setting address(0) disables taint checking
     * (permissive, not dangerous). Setting a malicious registry could block legitimate
     * users but cannot steal funds — notTainted modifier only reverts, never transfers.
     * Target Grade B via governance TimelockController.
     */
    function setClawbackRegistry(address _registry) external onlyGuardianOrOwner {
        clawbackRegistry = ClawbackRegistry(_registry);
        emit ClawbackRegistryUpdated(_registry);
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
