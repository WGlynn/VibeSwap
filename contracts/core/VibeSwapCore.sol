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
// TRP-R32-CB02: VibeSwapCore now inherits CircuitBreaker (CB-02 fix).
// commitSwap and revealSwap are protected by VOLUME_BREAKER.
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
    UUPSUpgradeable,
    CircuitBreaker
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

    struct CrossChainOrder {
        uint256 commitTimestamp;
        uint32 destinationChain;
        bytes32 commitHash;
        uint256 depositAmount;
        address tokenIn;
        address trader;
        bool settled;
    }

    /// @notice Queued failed execution for retry (incentive tracking failures)
    struct FailedExecution {
        bytes32 poolId;
        address trader;
        uint256 amountIn;
        uint256 estimatedOut;
        bytes reason;
        uint256 timestamp;
    }

    // ============ Constants ============

    /// @notice Maximum number of failed executions to queue (don't block settlement)
    uint256 public constant MAX_FAILED_QUEUE = 1000;

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

    /// @notice Cross-chain order tracking (commitHash => CrossChainOrder)
    mapping(bytes32 => CrossChainOrder) public crossChainOrders;

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

    /// @notice Temporary cumulative validated amounts per trader-token pair (cleared after each batch)
    mapping(bytes32 => uint256) private _cumulativeValidated;

    /// @notice TimelockController for governance-gated admin functions (Phase 2 disintermediation)
    address public timelockController;

    /// @notice Queue of failed incentive/compliance executions for retry
    FailedExecution[] public failedExecutions;

    /// @notice Maps (batchId, orderIndex) → actual depositor address
    /// @dev Needed because auction records core as trader, but deposits are keyed by user
    mapping(uint64 => mapping(uint256 => address)) private _orderDepositors;

    /// @notice DEPRECATED — was used for sequential indexing, replaced by CRA array length query (TRP-R16-F07)
    /// @dev Kept to preserve storage layout for UUPS proxy compatibility. Do not use.
    mapping(uint64 => uint256) private _orderRevealCount_DEPRECATED;

    /// @dev Reserved storage gap for future upgrades
    uint256[44] private __gap;

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
    event TimelockControllerUpdated(address indexed oldTimelock, address indexed newTimelock);

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

    // FIX #6b: Failed execution queue events (retry mechanism)
    event FailedExecutionQueued(uint256 indexed index, bytes32 indexed poolId, address indexed trader);
    event FailedExecutionRetried(uint256 indexed index, bool success);

    // SEC-1: Event for refunded orders in partial batch failures
    event OrderRefunded(
        uint64 indexed batchId,
        address indexed trader,
        address tokenIn,
        uint256 amountIn,
        string reason
    );

    // Cross-chain order lifecycle events
    event CrossChainOrderCreated(
        bytes32 indexed commitHash,
        address indexed trader,
        uint32 destinationChain,
        address tokenIn,
        uint256 depositAmount
    );
    event CrossChainOrderRefunded(
        bytes32 indexed commitHash,
        address indexed trader,
        address tokenIn,
        uint256 depositAmount
    );
    event CrossChainOrderSettled(bytes32 indexed commitHash);

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
    // NotGuardian() inherited from CircuitBreaker
    error WalletTainted();
    error NotGovernance();
    error CrossChainOrderNotExpired();
    error CrossChainOrderAlreadySettled();
    error CrossChainOrderNotFound();

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

    /// @notice Governance gate: allows timelock OR owner (migration period)
    modifier onlyGovernance() {
        require(
            msg.sender == owner() || (timelockController != address(0) && msg.sender == timelockController),
            "Not governance"
        );
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

        // TRP-R32-CB02: Configure circuit breakers for commit/reveal protection.
        _configureDefaultBreakers();
    }

    /**
     * @notice Configure default circuit breakers for VibeSwapCore
     * @dev Called once during initialize. VOLUME_BREAKER guards commitSwap and revealSwap.
     */
    function _configureDefaultBreakers() internal {
        // Volume breaker: trips if >10M token volume in 1 hour window
        breakerConfigs[VOLUME_BREAKER] = BreakerConfig({
            enabled: true,
            threshold: 10_000_000 * 1e18,
            cooldownPeriod: 1 hours,
            windowDuration: 1 hours
        });
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
    ) external payable whenNotPaused whenNotGloballyPaused whenBreakerNotTripped(VOLUME_BREAKER) nonReentrant notBlacklisted notTainted onlyEOAOrWhitelisted
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
        // Use address(this) as the depositor identity because VibeSwapCore is msg.sender
        // when calling auction.commitOrder, so commitment.depositor = address(this).
        // revealSwap passes address(this) as originalDepositor to satisfy the depositor check,
        // and the hash is verified with address(this) as well.
        bytes32 commitHash = keccak256(abi.encodePacked(
            address(this),
            tokenIn,
            tokenOut,
            amountIn,
            minAmountOut,
            secret
        ));

        // Deposit tokens
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        deposits[msg.sender][tokenIn] += amountIn;

        // Submit to auction — pass amountIn as estimatedTradeValue for proper collateral sizing.
        // TRP-R38: Previously called 1-arg commitOrder which passed estimatedTradeValue=0,
        // allowing MIN_DEPOSIT bypass. commitSwap knows the exact trade size, so pass it directly.
        commitId = auction.commitOrderToPool{value: msg.value}(bytes32(0), commitHash, amountIn);

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
    ) external payable whenNotPaused whenNotGloballyPaused whenBreakerNotTripped(VOLUME_BREAKER) nonReentrant {
        SwapParams storage params = pendingSwaps[commitId];
        require(params.amountIn > 0, "Invalid commit");

        // Verify ownership - only original committer can reveal
        require(commitOwners[commitId] == msg.sender, "Not commit owner");

        // Update priority bid
        params.priorityBid = priorityBid;

        // Reveal to auction - use cross-chain variant since we're acting on behalf of user
        // Pass address(this) as originalDepositor because VibeSwapCore is the depositor
        // in the auction (commitment.depositor = address(this)), and commitHash was
        // generated with address(this) as the identity in commitSwap.
        uint64 currentBatchId = auction.getCurrentBatchId();

        // INT-R1-INT003: Call CRA first, THEN read the array length to get the actual
        // index where the order was stored. The old code read length BEFORE the call,
        // creating a TOCTOU race if a direct CRA.revealOrder() was interleaved by a
        // miner/sequencer between the length read and the revealOrderCrossChain call.
        // After the CRA call, the new length - 1 is the guaranteed index of our order.
        auction.revealOrderCrossChain{value: msg.value}(
            commitId,
            address(this), // Core contract is the depositor in the auction commitment
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            params.minAmountOut,
            params.secret,
            priorityBid
        );

        uint256 actualOrderIdx = auction.getRevealedOrders(currentBatchId).length - 1;
        _orderDepositors[currentBatchId][actualOrderIdx] = msg.sender;

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
    ) external payable whenNotPaused whenNotGloballyPaused whenBreakerNotTripped(VOLUME_BREAKER) nonReentrant notBlacklisted notTainted onlyEOAOrWhitelisted
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

        // Track cross-chain order for timeout refunds
        crossChainOrders[commitHash] = CrossChainOrder({
            commitTimestamp: block.timestamp,
            destinationChain: dstChainId,
            commitHash: commitHash,
            depositAmount: amountIn,
            tokenIn: tokenIn,
            trader: msg.sender,
            settled: false
        });

        // Send via router
        // TRP-R22-H03: msg.value is the LZ fee. depositAmount passed explicitly.
        // TRP-R48-NEW10: Pass actual user address so destination records correct depositor
        router.sendCommit{value: msg.value}(dstChainId, commitHash, amountIn, options, msg.sender);

        emit CrossChainOrderCreated(commitHash, msg.sender, dstChainId, tokenIn, amountIn);
    }

    /**
     * @notice Refund a cross-chain order that has expired (LayerZero message failed or timed out)
     * @param commitHash The commitment hash of the cross-chain order
     * @dev Anyone can call this after the 2-hour timeout, but funds go to the original trader.
     *      The 2-hour window gives LayerZero sufficient time for message delivery + retries.
     *
     * DISINTERMEDIATION: Grade A (DISSOLVED). Permissionless after timeout — no trust required.
     */
    function refundExpiredCrossChain(bytes32 commitHash) external nonReentrant {
        CrossChainOrder storage order = crossChainOrders[commitHash];
        if (order.trader == address(0)) revert CrossChainOrderNotFound();
        if (order.settled) revert CrossChainOrderAlreadySettled();
        if (block.timestamp <= order.commitTimestamp + 2 hours) revert CrossChainOrderNotExpired();

        order.settled = true;

        // Release deposit back to original trader
        deposits[order.trader][order.tokenIn] -= order.depositAmount;
        IERC20(order.tokenIn).safeTransfer(order.trader, order.depositAmount);

        emit CrossChainOrderRefunded(commitHash, order.trader, order.tokenIn, order.depositAmount);
    }

    /**
     * @notice Mark a cross-chain order as settled (prevents refund after successful delivery)
     * @param commitHash The commitment hash of the cross-chain order
     * @dev Called by owner or router after confirming the destination chain processed the order.
     *
     * DISINTERMEDIATION: Grade C → Target Grade B. Owner/router marks settlement.
     * Target: router auto-marks on lzReceive callback; owner as fallback.
     */
    function markCrossChainSettled(bytes32 commitHash) external {
        require(
            msg.sender == owner() || msg.sender == address(router),
            "Only owner or router"
        );
        CrossChainOrder storage order = crossChainOrders[commitHash];
        if (order.trader == address(0)) revert CrossChainOrderNotFound();
        if (order.settled) revert CrossChainOrderAlreadySettled();

        order.settled = true;
        emit CrossChainOrderSettled(commitHash);
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
     * @notice Create a new liquidity pool — PERMISSIONLESS (via this contract)
     *
     * DISINTERMEDIATION: Grade A (DISSOLVED). Any caller can create pools
     * through VibeSwapCore. Note: VibeAMM.createPool() itself is gated to
     * owner/authorizedExecutors (M-10: prevents front-running deterministic
     * pool IDs with extreme fee rates). Permissionless access is provided by
     * routing through this contract, which holds an authorizedExecutor slot.
     * Direct VibeAMM.createPool() calls from non-authorized addresses revert.
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
    ) external onlyGovernance {
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
    ) external onlyGovernance {
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
    function setWBAR(address _wbar) external onlyGovernance {
        wbar = IwBAR(_wbar);
        emit WBARUpdated(_wbar);
    }

    /**
     * @notice Set the IncentiveController for auction proceeds and execution tracking
     * @param _controller IncentiveController proxy address (or address(0) to disable)
     *
     * DISINTERMEDIATION: Grade C → Target Grade B. Requires governance (TimelockController).
     */
    function setIncentiveController(address _controller) external onlyGovernance {
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

    /// @notice Resolve actual depositor for an order in a batch
    /// @dev TRP-R16-F07: Two cases:
    ///      1. Core-originated order (trader == address(this)): look up real user from
    ///         _orderDepositors, keyed by actual revealedOrders index (not a separate counter).
    ///      2. Direct CRA order (trader != address(this)): trader IS the real depositor.
    function _getDepositor(uint64 batchId, uint256 orderIdx, address fallbackTrader) internal view returns (address) {
        if (fallbackTrader == address(this)) {
            address depositor = _orderDepositors[batchId][orderIdx];
            return depositor != address(0) ? depositor : fallbackTrader;
        }
        return fallbackTrader;
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

        // Track unique trader-token keys for cleanup after the loop.
        bytes32[] memory usedKeys = new bytes32[](executionOrder.length);
        uint256 usedKeyCount = 0;

        for (uint256 i = 0; i < executionOrder.length;) {
            uint256 idx = executionOrder[i];
            ICommitRevealAuction.RevealedOrder memory order = orders[idx];

            // Resolve actual depositor (auction records core as trader)
            address depositor = _getDepositor(batchId, idx, order.trader);

            // O(1) cumulative lookup via storage mapping keyed on keccak256(depositor, tokenIn)
            bytes32 pairKey = keccak256(abi.encodePacked(depositor, order.tokenIn));
            uint256 cumulativeAmount = _cumulativeValidated[pairKey] + order.amountIn;

            // Verify cumulative deposit does not exceed available balance
            if (deposits[depositor][order.tokenIn] < cumulativeAmount) {
                emit OrderFailed(batchId, depositor, order.tokenIn, order.tokenOut, order.amountIn, "Insufficient deposit");
                unchecked { ++i; }
                continue;
            }

            // Update cumulative tracker
            if (_cumulativeValidated[pairKey] == 0) {
                usedKeys[usedKeyCount] = pairKey;
                unchecked { ++usedKeyCount; }
            }
            _cumulativeValidated[pairKey] = cumulativeAmount;

            bytes32 poolId = amm.getPoolId(order.tokenIn, order.tokenOut);
            orderPoolIds[i] = poolId;
            orderValid[i] = true;

            // Track unique pools
            bool found = false;
            for (uint256 j = 0; j < uniquePoolCount;) {
                if (poolIds[j] == poolId) { found = true; break; }
                unchecked { ++j; }
            }
            if (!found) {
                poolIds[uniquePoolCount] = poolId;
                unchecked { ++uniquePoolCount; }
            }
            unchecked { ++i; }
        }

        // Clean up storage mapping to avoid stale state and reclaim gas
        for (uint256 k = 0; k < usedKeyCount;) {
            delete _cumulativeValidated[usedKeys[k]];
            unchecked { ++k; }
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
        for (uint256 p = 0; p < uniquePoolCount;) {
            (uint256 vol, uint256 price) = _executePoolIteration(
                batchId, orders, executionOrder, orderPoolIds, orderValid, poolIds[p]
            );
            if (vol > 0) {
                totalVolume += vol;
                lastClearingPrice = price;
            }
            unchecked { ++p; }
        }
    }

    /// @dev Loop body for _executePoolBatches — extracted to reduce stack depth.
    function _executePoolIteration(
        uint64 batchId,
        ICommitRevealAuction.RevealedOrder[] memory orders,
        uint256[] memory executionOrder,
        bytes32[] memory orderPoolIds,
        bool[] memory orderValid,
        bytes32 poolId
    ) internal returns (uint256 volAdded, uint256 clearingPrice) {
        (
            IVibeAMM.SwapOrder[] memory swapOrders,
            uint256[] memory originalIndices,
            uint256 count
        ) = _buildPoolSwapOrders(batchId, orders, executionOrder, orderPoolIds, orderValid, poolId);

        if (count == 0) return (0, 0);

        IVibeAMM.BatchSwapResult memory result = amm.executeBatchSwap(poolId, batchId, swapOrders);

        if (result.totalTokenInSwapped > 0) {
            _settleExecutedOrders(batchId, orders, originalIndices, count, poolId, result);
            return (result.totalTokenInSwapped, result.clearingPrice);
        } else {
            _emitFailedOrders(batchId, orders, originalIndices, count);
            return (0, 0);
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
        for (uint256 i = 0; i < executionOrder.length;) {
            if (orderValid[i] && orderPoolIds[i] == poolId) { unchecked { ++count; } }
            unchecked { ++i; }
        }
        if (count == 0) return (swapOrders, originalIndices, 0);

        swapOrders = new IVibeAMM.SwapOrder[](count);
        originalIndices = new uint256[](count);
        uint256 cursor = 0;

        for (uint256 i = 0; i < executionOrder.length;) {
            if (!orderValid[i] || orderPoolIds[i] != poolId) { unchecked { ++i; } continue; }

            uint256 idx = executionOrder[i];
            ICommitRevealAuction.RevealedOrder memory order = orders[idx];
            address depositor = _getDepositor(batchId, idx, order.trader);
            address recipient = _resolveRecipient(batchId, depositor);

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
            unchecked { ++cursor; ++i; }
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
        for (uint256 k = 0; k < count;) {
            totalInputSent += orders[originalIndices[k]].amountIn;
            unchecked { ++k; }
        }
        bool hasFailures = result.totalTokenInSwapped < totalInputSent;

        // Get pool info for per-order failure detection (only when needed)
        IVibeAMM.Pool memory pool;
        if (hasFailures) {
            pool = amm.getPool(poolId);
        }

        for (uint256 k = 0; k < count;) {
            uint256 idx = originalIndices[k];
            ICommitRevealAuction.RevealedOrder memory order = orders[idx];

            // SEC-1: Skip failed orders within a partial batch — don't decrement their deposits.
            // INT-R1-INT001: Use input-fee model matching AMM's actual execution path.
            // Old code used output-fee (grossOut * (1-fee)) with static pool.feeRate.
            // AMM uses input-fee (effIn = amountIn * (1-fee), then effIn * price) with
            // dynamic batchFeeRate including True Price surcharge.
            if (hasFailures) {
                bool isToken0 = order.tokenIn == pool.token0;
                uint256 effIn = (order.amountIn * (10000 - result.batchFeeRate)) / 10000;
                uint256 netOut;
                if (isToken0) {
                    netOut = (effIn * result.clearingPrice) / 1e18;
                } else {
                    netOut = result.clearingPrice > 0
                        ? (effIn * 1e18) / result.clearingPrice
                        : 0;
                }

                if (netOut < order.minAmountOut) {
                    emit OrderRefunded(
                        batchId, _getDepositor(batchId, idx, order.trader), order.tokenIn, order.amountIn,
                        "Partial batch: slippage or liquidity failure"
                    );
                    unchecked { ++k; }
                    continue;
                }
            }

            uint256 estimatedOut = 0;
            {
                // Scoped to avoid stack-too-deep
                address depositor = _getDepositor(batchId, idx, order.trader);
                deposits[depositor][order.tokenIn] -= order.amountIn;

                if (result.clearingPrice > 0 && result.totalTokenInSwapped > 0) {
                    estimatedOut = (order.amountIn * result.totalTokenOutSwapped) / result.totalTokenInSwapped;
                }

                _settleWBAR(batchId, depositor, estimatedOut);
            }

            // Record execution + compliance
            _recordExecution(poolId, order, estimatedOut);
            unchecked { ++k; }
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
     * @dev Failed incentive recordings are queued for retry instead of silently swallowed.
     *      Compliance failures are still event-only (non-retryable side effect).
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
                _queueFailedExecution(poolId, order.trader, order.amountIn, estimatedOut, reason);
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
     * @notice Queue a failed incentive execution for later retry
     * @dev Silently skips if queue is full to avoid blocking settlement
     */
    function _queueFailedExecution(
        bytes32 poolId,
        address trader,
        uint256 amountIn,
        uint256 estimatedOut,
        bytes memory reason
    ) internal {
        if (failedExecutions.length >= MAX_FAILED_QUEUE) return;

        failedExecutions.push(FailedExecution({
            poolId: poolId,
            trader: trader,
            amountIn: amountIn,
            estimatedOut: estimatedOut,
            reason: reason,
            timestamp: block.timestamp
        }));

        emit FailedExecutionQueued(failedExecutions.length - 1, poolId, trader);
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
        for (uint256 k = 0; k < count;) {
            uint256 idx = originalIndices[k];
            ICommitRevealAuction.RevealedOrder memory order = orders[idx];
            address depositor = _getDepositor(batchId, idx, order.trader);
            emit OrderFailed(batchId, depositor, order.tokenIn, order.tokenOut, order.amountIn, "Swap execution failed");
            unchecked { ++k; }
        }
    }

    /**
     * @notice Forward priority bids to DAO treasury
     * @dev Pulls ETH from CommitRevealAuction first (where priority bids accumulate),
     *      then forwards to treasury. Prior to TRP-R16-F01 fix, this checked
     *      address(this).balance which was always 0 — ETH lived in CRA, not Core.
     */
    function _forwardPriorityBids(uint64 batchId) internal {
        uint256 amount = auction.withdrawPriorityBids(batchId);
        if (amount > 0) {
            treasury.receiveAuctionProceeds{value: amount}(batchId);
        }
    }

    // ============ Failed Execution Recovery ============

    /**
     * @notice Retry a failed incentive controller execution
     * @param index Index into the failedExecutions array
     *
     * DISINTERMEDIATION: Grade C -> Target Grade B. Admin recovery for failed reward distributions.
     */
    function retryFailedExecution(uint256 index) external onlyOwner {
        require(index < failedExecutions.length, "Index out of bounds");
        FailedExecution memory failed = failedExecutions[index];
        require(failed.trader != address(0), "Already retried");
        require(address(incentiveController) != address(0), "No incentive controller");

        // Clear before retry to prevent reentrancy
        delete failedExecutions[index];

        try incentiveController.recordExecution(
            failed.poolId, failed.trader, failed.amountIn, failed.estimatedOut, 0
        ) {
            emit FailedExecutionRetried(index, true);
        } catch {
            // Re-queue if still failing
            failedExecutions[index] = failed;
            emit FailedExecutionRetried(index, false);
        }
    }

    /**
     * @notice Get the number of queued failed executions
     * @return count Total entries (includes cleared slots from successful retries)
     */
    function getFailedExecutionCount() external view returns (uint256 count) {
        return failedExecutions.length;
    }

    /**
     * @notice Compact the failedExecutions array by removing zeroed-out (retried) entries
     * @dev INT-R1-INT005: `delete failedExecutions[index]` zeroes the struct but doesn't
     *      shrink the array. Once length hits MAX_FAILED_QUEUE, new failures are silently
     *      dropped even if all entries have been retried. This function compacts the array.
     *
     * DISINTERMEDIATION: Grade C -> Target Grade A. Permissionless compaction is safe
     * because it only removes already-deleted entries (trader == address(0)).
     */
    function compactFailedExecutions() external {
        uint256 writeIdx = 0;
        uint256 len = failedExecutions.length;
        for (uint256 readIdx = 0; readIdx < len;) {
            if (failedExecutions[readIdx].trader != address(0)) {
                if (writeIdx != readIdx) {
                    failedExecutions[writeIdx] = failedExecutions[readIdx];
                }
                unchecked { ++writeIdx; }
            }
            unchecked { ++readIdx; }
        }
        // Trim the array to only contain live entries
        uint256 toRemove = len - writeIdx;
        for (uint256 i = 0; i < toRemove;) {
            failedExecutions.pop();
            unchecked { ++i; }
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

        // Update state — atomic window reset to prevent same-block bypass
        if (block.timestamp >= limit.windowStart + limit.windowDuration) {
            // New window — set usedAmount to THIS tx's amount and return early
            userRateLimits[user] = SecurityLib.RateLimit({
                windowStart: block.timestamp,
                windowDuration: 1 hours,
                maxAmount: maxSwapPerHour,
                usedAmount: amount
            });
            return;
        }
        userRateLimits[user].usedAmount = newUsedAmount;
    }

    // ============ Security Admin Functions ============

    /**
     * @notice Set blacklist status for an address
     *
     * DISINTERMEDIATION: KEEP — security enforcement requires rapid response.
     * Target Grade B: guardian multisig + governance can blacklist.
     * Cannot be permissionless (griefing: anyone blacklists competitors).
     */
    function setBlacklist(address user, bool status) external onlyGovernance {
        blacklisted[user] = status;
        emit UserBlacklisted(user, status);
    }

    /**
     * @notice Batch blacklist addresses (for known exploit contracts)
     *
     * DISINTERMEDIATION: KEEP — same as setBlacklist. Security enforcement.
     */
    function batchBlacklist(address[] calldata users, bool status) external onlyGovernance {
        require(users.length <= 200, "Batch too large");
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
    function setContractWhitelist(address contractAddr, bool status) external onlyGovernance {
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
    function setGuardian(address newGuardian) external onlyGovernance {
        require(newGuardian != address(0), "Invalid guardian");
        emit GuardianUpdated(guardian, newGuardian);
        guardian = newGuardian;
    }

    /**
     * @notice Set the TimelockController address for governance-gated functions
     * @param _timelock TimelockController address (address(0) to disable governance gate)
     *
     * DISINTERMEDIATION: Grade C (onlyOwner). This is the bootstrap function that
     * enables Phase 2 — once set, onlyGovernance functions accept the timelock as caller.
     * Only owner can set this (you can't use governance to set governance).
     */
    function setTimelockController(address _timelock) external onlyOwner {
        emit TimelockControllerUpdated(timelockController, _timelock);
        timelockController = _timelock;
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
