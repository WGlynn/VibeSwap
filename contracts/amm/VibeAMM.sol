// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./VibeLP.sol";
import "../core/interfaces/IVibeAMM.sol";
import "../core/CircuitBreaker.sol";
import "../libraries/BatchMath.sol";
import "../libraries/SecurityLib.sol";
import "../libraries/TWAPOracle.sol";
import "../libraries/VWAPOracle.sol";
import "../libraries/TruePriceLib.sol";
import "../libraries/LiquidityProtection.sol";
import "../libraries/FibonacciScaling.sol";
import "../libraries/ProofOfWorkLib.sol";
import "../oracles/interfaces/ITruePriceOracle.sol";
import "../incentives/IPriorityRegistry.sol";
import "../incentives/interfaces/IIncentiveController.sol";

/**
 * @title VibeAMM
 * @notice Constant product AMM with batch swap execution for MEV-resistant trading
 * @dev Implements x*y=k invariant with uniform clearing price for batches
 *      Includes comprehensive security measures against known DEX exploits
 */
contract VibeAMM is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    CircuitBreaker,
    IVibeAMM
{
    using SafeERC20 for IERC20;
    using BatchMath for uint256;
    using TWAPOracle for TWAPOracle.OracleState;
    using VWAPOracle for VWAPOracle.VWAPState;

    // ============ Constants ============

    /// @notice Default fee rate (0.05% - 5 basis points)
    /// @dev Optimized for socioeconomic equality: negligible for all trade sizes
    ///      while still compensating LPs. Lower than traditional AMMs because
    ///      batch auctions reduce impermanent loss from MEV extraction.
    uint256 public constant DEFAULT_FEE_RATE = 5;

    /// @notice Protocol's share of base fees in BPS (default 0 = all to LPs)
    /// @dev Configurable via setProtocolFeeShare(). Revenue flows:
    ///      - 0 (default): 100% of base fees to LPs (pure LP model)
    ///      - >0: portion routed to treasury/ProtocolFeeAdapter for cooperative distribution
    ///      Max 2500 (25%) to ensure LPs always get majority of fees.
    uint256 public protocolFeeShare;

    /// @notice Minimum liquidity locked forever (prevents first depositor attack)
    uint256 public constant MINIMUM_LIQUIDITY = 10000;

    /// @notice Maximum price deviation from TWAP allowed (5%)
    uint256 public constant MAX_PRICE_DEVIATION_BPS = 500;

    /// @notice Maximum balance excess from donations allowed (1%)
    uint256 public constant MAX_DONATION_BPS = 100;

    /// @notice Default TWAP period for price validation
    uint32 public constant DEFAULT_TWAP_PERIOD = 10 minutes;

    /// @notice Maximum single trade as percentage of reserves (10%)
    uint256 public constant MAX_TRADE_SIZE_BPS = 1000;

    /// @notice Maximum reserve drain per swap (99% — prevents total reserve depletion)
    uint256 private constant MAX_RESERVE_DRAIN_PERCENT = 99;

    // ============ Structs for Parameter Bundling ============

    /// @notice Parameters for basic swap to reduce stack depth
    struct SwapParams {
        bytes32 poolId;
        address tokenIn;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
    }

    /// @notice Parameters for PoW swap to reduce stack depth
    struct PoWSwapParams {
        bytes32 poolId;
        address tokenIn;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
        bytes32 powNonce;
        uint8 powAlgorithm;
        uint8 claimedDifficulty;
    }

    // ============ State ============

    /// @notice Mapping of pool ID to pool data
    mapping(bytes32 => Pool) public pools;

    /// @notice Mapping of pool ID to LP token address
    mapping(bytes32 => address) public lpTokens;

    /// @notice Mapping of pool ID to user to LP balance (backup tracking)
    mapping(bytes32 => mapping(address => uint256)) public liquidityBalance;

    /// @notice DAO treasury for dynamic volatility fees (routed to insurance)
    /// @dev Base trading fees go 100% to LPs. Treasury only receives dynamic
    ///      volatility fee excess during high-vol periods, which funds insurance.
    address public treasury;

    /// @notice Authorized executors (VibeSwapCore)
    mapping(address => bool) public authorizedExecutors;

    /// @notice Accumulated protocol fees per token
    mapping(address => uint256) public accumulatedFees;

    // ============ Security State ============

    /// @notice TWAP oracle state per pool
    mapping(bytes32 => TWAPOracle.OracleState) internal poolOracles;

    /// @notice Tracked balances per token (for donation attack detection)
    mapping(address => uint256) public trackedBalances;

    /// @notice Last interaction block per user (for same-block manipulation detection)
    mapping(address => uint256) public lastInteractionBlock;

    /// @notice Flash loan protection - users who interacted this block
    mapping(bytes32 => bool) internal sameBlockInteraction;

    /// @notice Custom max trade size per pool (0 = use default)
    mapping(bytes32 => uint256) public poolMaxTradeSize;

    // ============ Gas-Optimized Packed Flags ============
    // Pack 5 bools into single uint8 slot (saves ~4 storage slots = 80,000 gas on deployment)

    /// @notice Packed protection flags (bit 0=flash, 1=twap, 2=truePrice, 3=liquidity, 4=fibonacci)
    uint8 public protectionFlags;

    // Flag bit positions
    uint8 private constant FLAG_FLASH_LOAN = 1 << 0;      // bit 0
    uint8 private constant FLAG_TWAP = 1 << 1;            // bit 1
    uint8 private constant FLAG_TRUE_PRICE = 1 << 2;      // bit 2
    uint8 private constant FLAG_LIQUIDITY = 1 << 3;       // bit 3
    uint8 private constant FLAG_FIBONACCI = 1 << 4;       // bit 4

    // ============ True Price Oracle Integration ============

    /// @notice True Price Oracle for manipulation-resistant price validation
    ITruePriceOracle public truePriceOracle;

    /// @notice Maximum staleness for True Price data (default 5 minutes)
    uint256 public truePriceMaxStaleness = 5 minutes;

    // ============ VWAP Oracle & Liquidity Protection ============

    /// @notice VWAP oracle state per pool
    mapping(bytes32 => VWAPOracle.VWAPState) internal poolVWAP;

    /// @notice Liquidity protection config per pool
    mapping(bytes32 => LiquidityProtection.ProtectionConfig) public poolProtectionConfig;

    /// @notice Price oracle for USD value calculations (e.g., Chainlink)
    address public priceOracle;

    /// @notice Cached USD prices per token (updated by keeper)
    mapping(address => uint256) public tokenUsdPrices;

    // ============ Fibonacci Scaling State ============

    /// @notice User throughput tracking per pool (user => pool => volume in window)
    mapping(address => mapping(bytes32 => uint256)) public userPoolVolume;

    /// @notice User volume window start timestamp
    mapping(address => uint256) public userVolumeWindowStart;

    /// @notice Base unit for Fibonacci tier calculation (per pool)
    mapping(bytes32 => uint256) public fibonacciBaseUnit;

    /// @notice Recent high price per pool (for Fib retracement)
    mapping(bytes32 => uint256) public recentHighPrice;

    /// @notice Recent low price per pool (for Fib retracement)
    mapping(bytes32 => uint256) public recentLowPrice;

    /// @notice Fibonacci volume window duration (default 1 hour)
    uint256 public fibonacciWindowDuration = 1 hours;

    // ============ Proof-of-Work Fee Discount State ============

    /// @notice PriorityRegistry for recording pool creation pioneers
    IPriorityRegistry public priorityRegistry;

    /// @notice Maximum fee discount from PoW (basis points, e.g., 5000 = 50%)
    uint256 public maxPoWFeeDiscount = 5000;

    /// @notice Used PoW proofs for fee discounts (prevents replay)
    mapping(bytes32 => bool) public usedFeePoWProofs;

    // ============ Incentive Controller Integration ============

    /// @notice IncentiveController for LP lifecycle hooks and volatility fee routing
    /// @dev Set via setIncentiveController(). All hook calls are try/catch to prevent
    ///      incentive layer issues from blocking core AMM operations.
    IIncentiveController public incentiveController;

    // ============ Security Events ============

    event FlashLoanAttemptBlocked(address indexed user, bytes32 indexed poolId);
    event PriceManipulationDetected(bytes32 indexed poolId, uint256 spotPrice, uint256 twapPrice);
    event DonationAttackDetected(address indexed token, uint256 tracked, uint256 actual);
    event LargeTradeLimited(bytes32 indexed poolId, uint256 requested, uint256 allowed);
    event FeesCollected(address indexed token, uint256 amount);
    event TruePriceOracleUpdated(address indexed oracle);
    event TruePriceValidationResult(bytes32 indexed poolId, uint256 spotPrice, uint256 truePrice, bool passed);
    event LiquidityProtectionConfigured(bytes32 indexed poolId, uint256 amplification, uint256 maxImpactBps);
    event DynamicFeeApplied(bytes32 indexed poolId, uint256 baseFee, uint256 adjustedFee);
    event TradeRejectedLowLiquidity(bytes32 indexed poolId, uint256 liquidity, uint256 minimum);
    event FibonacciTierReached(bytes32 indexed poolId, address indexed user, uint8 tier, uint256 volume);
    event FibonacciPriceLevelDetected(bytes32 indexed poolId, uint256 price, uint256 fibLevel, bool isSupport);
    event FibonacciFeeApplied(bytes32 indexed poolId, uint256 baseFee, uint256 fibFee, uint8 tier);
    event PoWFeeDiscountApplied(bytes32 indexed poolId, address indexed user, uint8 difficulty, uint256 discountBps);
    event IncentiveControllerUpdated(address indexed controller);
    event VolatilityFeeRouted(bytes32 indexed poolId, address token, uint256 amount);

    // FIX #5: Event for swap failures
    event SwapFailed(
        bytes32 indexed poolId,
        address indexed trader,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 minAmountOut,
        string reason
    );

    // ============ Admin Events ============

    event AuthorizedExecutorUpdated(address indexed executor, bool authorized);
    event TreasuryUpdated(address indexed treasury);
    event ProtocolFeeShareUpdated(uint256 feeBps);
    event LiquidityProtectionToggled(bool enabled);
    event TokenPriceUpdated(address indexed token, uint256 price);
    event PriceOracleUpdated(address indexed oracle);
    event PriorityRegistryUpdated(address indexed registry);
    event VWAPCardinalityGrown(bytes32 indexed poolId, uint16 cardinality);
    event FlashLoanProtectionToggled(bool enabled);
    event TWAPValidationToggled(bool enabled);
    event PoolMaxTradeSizeUpdated(bytes32 indexed poolId, uint256 maxSize);
    event OracleCardinalityGrown(bytes32 indexed poolId, uint16 cardinality);
    event TrackedBalanceSynced(address indexed token, uint256 balance);
    event FibonacciScalingToggled(bool enabled);
    event FibonacciBaseUnitUpdated(bytes32 indexed poolId, uint256 baseUnit);
    event FibonacciWindowDurationUpdated(uint256 duration);
    event FibonacciPriceLevelsReset(bytes32 indexed poolId);
    event MaxPoWFeeDiscountUpdated(uint256 maxDiscountBps);

    // ============ Security Errors ============

    error FlashLoanDetected();
    error PriceDeviationTooHigh(uint256 spotPrice, uint256 twapPrice);
    error SameBlockInteraction();
    error TradeTooLarge(uint256 maxAllowed);
    error DonationAttackSuspected();
    error PriceImpactExceedsLimit(uint256 impact, uint256 maxAllowed);
    error InsufficientPoolLiquidity(uint256 current, uint256 minimum);
    error FibonacciRateLimitExceeded(uint256 requested, uint256 allowed, uint256 cooldownSeconds);

    // ============ Gas-Optimized Custom Errors ============

    error NotAuthorized();
    error PoolNotFound();
    error InvalidToken();
    error IdenticalTokens();
    error PoolAlreadyExists();
    error FeeTooHigh();
    error InvalidTreasury();
    error InsufficientToken0();
    error InsufficientToken1();
    error InitialLiquidityTooLow();
    error InsufficientLiquidityMinted();
    error InvalidLiquidity();
    error InsufficientLiquidityBalance();
    error InsufficientOutput();
    error NoFeesToCollect();
    error InvalidPoWProof();
    error PoWProofAlreadyUsed();
    error InvalidBaseUnit();
    error InvalidDuration();
    error InvalidDiscount();

    // ============ Modifiers ============

    modifier onlyAuthorizedExecutor() {
        if (!authorizedExecutors[msg.sender]) revert NotAuthorized();
        _;
    }

    modifier poolExists(bytes32 poolId) {
        if (!pools[poolId].initialized) revert PoolNotFound();
        _;
    }

    /// @notice Prevents flash loan attacks by blocking same-block interactions
    modifier noFlashLoan(bytes32 poolId) {
        if ((protectionFlags & FLAG_FLASH_LOAN) != 0) {
            bytes32 interactionKey = keccak256(abi.encodePacked(msg.sender, poolId, block.number));
            if (sameBlockInteraction[interactionKey]) {
                emit FlashLoanAttemptBlocked(msg.sender, poolId);
                revert SameBlockInteraction();
            }
            sameBlockInteraction[interactionKey] = true;
        }
        _;
    }

    /// @notice Validates price against TWAP to prevent manipulation
    modifier validatePrice(bytes32 poolId) {
        _;
        if ((protectionFlags & FLAG_TWAP) != 0 && poolOracles[poolId].cardinality >= 2) {
            _validatePriceAgainstTWAP(poolId);
        }
    }

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the contract
     * @param _owner Owner address
     * @param _treasury DAO treasury address
     */
    function initialize(
        address _owner,
        address _treasury
    ) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();

        if (_treasury == address(0)) revert InvalidTreasury();
        treasury = _treasury;

        // Enable security features by default (gas-optimized packed flags)
        protectionFlags = FLAG_FLASH_LOAN | FLAG_TWAP;

        // Configure default circuit breakers
        _configureDefaultBreakers();
    }

    /**
     * @notice Configure default circuit breakers for protection
     */
    function _configureDefaultBreakers() internal {
        // Volume breaker: trips if >$10M volume in 1 hour window
        breakerConfigs[VOLUME_BREAKER] = BreakerConfig({
            enabled: true,
            threshold: 10_000_000 * 1e18,
            cooldownPeriod: 1 hours,
            windowDuration: 1 hours
        });

        // Price breaker: trips if price moves >50% in window
        breakerConfigs[PRICE_BREAKER] = BreakerConfig({
            enabled: true,
            threshold: 5000, // 50% in basis points
            cooldownPeriod: 30 minutes,
            windowDuration: 15 minutes
        });

        // Withdrawal breaker: trips if >25% of TVL withdrawn in window
        breakerConfigs[WITHDRAWAL_BREAKER] = BreakerConfig({
            enabled: true,
            threshold: 2500, // 25% in basis points
            cooldownPeriod: 2 hours,
            windowDuration: 1 hours
        });
    }

    // ============ External Functions ============

    /**
     * @notice Create a new liquidity pool
     * @param token0 First token address
     * @param token1 Second token address
     * @param feeRate Fee rate in basis points
     * @return poolId Unique pool identifier
     */
    function createPool(
        address token0,
        address token1,
        uint256 feeRate
    ) external returns (bytes32 poolId) {
        if (token0 == address(0) || token1 == address(0)) revert InvalidToken();
        if (token0 == token1) revert IdenticalTokens();

        // Ensure consistent ordering
        (token0, token1) = token0 < token1 ? (token0, token1) : (token1, token0);

        poolId = getPoolId(token0, token1);
        if (pools[poolId].initialized) revert PoolAlreadyExists();

        uint256 actualFeeRate = feeRate == 0 ? DEFAULT_FEE_RATE : feeRate;
        if (actualFeeRate > 1000) revert FeeTooHigh(); // Max 10%

        pools[poolId] = Pool({
            token0: token0,
            token1: token1,
            reserve0: 0,
            reserve1: 0,
            totalLiquidity: 0,
            feeRate: actualFeeRate,
            initialized: true
        });

        // Deploy LP token
        VibeLP lpToken = new VibeLP(token0, token1, address(this));
        lpTokens[poolId] = address(lpToken);

        // Record pool creation priority (if registry configured)
        if (address(priorityRegistry) != address(0)) {
            try IPriorityRecorder(address(priorityRegistry)).recordPoolCreation(poolId, msg.sender) {} catch {}
        }

        emit PoolCreated(poolId, token0, token1, actualFeeRate);
    }

    /**
     * @notice Add liquidity to a pool
     * @param poolId Pool identifier
     * @param amount0Desired Desired amount of token0
     * @param amount1Desired Desired amount of token1
     * @param amount0Min Minimum amount of token0
     * @param amount1Min Minimum amount of token1
     * @return amount0 Actual amount of token0 added
     * @return amount1 Actual amount of token1 added
     * @return liquidity LP tokens minted
     */
    function addLiquidity(
        bytes32 poolId,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min
    ) external nonReentrant poolExists(poolId) noFlashLoan(poolId) whenNotGloballyPaused returns (
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity
    ) {
        Pool storage pool = pools[poolId];

        // Check for donation attack before calculating optimal amounts
        _checkDonationAttack(pool.token0);
        _checkDonationAttack(pool.token1);

        // Calculate optimal amounts
        (amount0, amount1) = BatchMath.calculateOptimalLiquidity(
            amount0Desired,
            amount1Desired,
            pool.reserve0,
            pool.reserve1
        );

        if (amount0 < amount0Min) revert InsufficientToken0();
        if (amount1 < amount1Min) revert InsufficientToken1();

        // Transfer tokens
        IERC20(pool.token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(pool.token1).safeTransferFrom(msg.sender, address(this), amount1);

        // Calculate liquidity tokens
        bool isFirstDeposit = pool.totalLiquidity == 0;
        liquidity = BatchMath.calculateLiquidity(
            amount0,
            amount1,
            pool.reserve0,
            pool.reserve1,
            pool.totalLiquidity
        );

        // FIRST DEPOSITOR ATTACK PROTECTION
        // Lock minimum liquidity to prevent share inflation attacks
        if (isFirstDeposit) {
            if (liquidity <= MINIMUM_LIQUIDITY) revert InitialLiquidityTooLow();
            // Burn minimum liquidity to dead address (prevents share manipulation)
            unchecked { liquidity -= MINIMUM_LIQUIDITY; } // Safe: checked above
            VibeLP(lpTokens[poolId]).mint(address(0xdead), MINIMUM_LIQUIDITY);
            pool.totalLiquidity += MINIMUM_LIQUIDITY;

            // Initialize TWAP oracle for this pool
            uint256 initialPrice = amount0 > 0 ? (amount1 * 1e18) / amount0 : 0;
            poolOracles[poolId].initialize(initialPrice);

            // Initialize VWAP oracle
            poolVWAP[poolId].initialize(initialPrice);
        }

        if (liquidity == 0) revert InsufficientLiquidityMinted();

        // Update reserves (use unchecked - amounts bounded by token supply)
        unchecked {
            pool.reserve0 += amount0;
            pool.reserve1 += amount1;
            pool.totalLiquidity += liquidity;
        }

        // Update tracked balances for donation detection
        trackedBalances[pool.token0] += amount0;
        trackedBalances[pool.token1] += amount1;

        // Update TWAP oracle
        _updateOracle(poolId);

        // Mint LP tokens
        VibeLP(lpTokens[poolId]).mint(msg.sender, liquidity);
        liquidityBalance[poolId][msg.sender] += liquidity;

        // Notify IncentiveController for IL protection and loyalty tracking
        if (address(incentiveController) != address(0)) {
            uint256 entryPrice = amount0 > 0 ? (amount1 * 1e18) / amount0 : 0;
            try incentiveController.onLiquidityAdded(poolId, msg.sender, liquidity, entryPrice) {} catch {}
        }

        emit LiquidityAdded(poolId, msg.sender, amount0, amount1, liquidity);
    }

    /**
     * @notice Remove liquidity from a pool
     * @param poolId Pool identifier
     * @param liquidity LP tokens to burn
     * @param amount0Min Minimum token0 to receive
     * @param amount1Min Minimum token1 to receive
     * @return amount0 Token0 received
     * @return amount1 Token1 received
     */
    function removeLiquidity(
        bytes32 poolId,
        uint256 liquidity,
        uint256 amount0Min,
        uint256 amount1Min
    ) external nonReentrant poolExists(poolId) noFlashLoan(poolId) whenNotGloballyPaused
      whenBreakerNotTripped(WITHDRAWAL_BREAKER) returns (
        uint256 amount0,
        uint256 amount1
    ) {
        Pool storage pool = pools[poolId];
        address lpToken = lpTokens[poolId];

        if (liquidity == 0) revert InvalidLiquidity();
        if (pool.totalLiquidity < liquidity) revert InvalidLiquidity();

        // Verify user has the LP tokens (check actual balance, not internal tracking)
        if (IERC20(lpToken).balanceOf(msg.sender) < liquidity) revert InsufficientLiquidityBalance();

        // Calculate amounts
        amount0 = (liquidity * pool.reserve0) / pool.totalLiquidity;
        amount1 = (liquidity * pool.reserve1) / pool.totalLiquidity;

        if (amount0 < amount0Min) revert InsufficientToken0();
        if (amount1 < amount1Min) revert InsufficientToken1();

        // Check withdrawal circuit breaker (percentage of TVL)
        uint256 withdrawalValueBps = pool.totalLiquidity > 0
            ? (liquidity * 10000) / pool.totalLiquidity
            : 0;
        _updateBreaker(WITHDRAWAL_BREAKER, withdrawalValueBps);

        // Update state before external calls (CEI pattern)
        // Use unchecked - amounts verified above, can't underflow
        unchecked {
            pool.reserve0 -= amount0;
            pool.reserve1 -= amount1;
            pool.totalLiquidity -= liquidity;
        }

        // Update tracked balances
        if (trackedBalances[pool.token0] >= amount0) {
            unchecked { trackedBalances[pool.token0] -= amount0; }
        }
        if (trackedBalances[pool.token1] >= amount1) {
            unchecked { trackedBalances[pool.token1] -= amount1; }
        }

        // Update internal tracking (use min to prevent underflow if LP was transferred)
        uint256 tracked = liquidityBalance[poolId][msg.sender];
        unchecked {
            liquidityBalance[poolId][msg.sender] = tracked >= liquidity ? tracked - liquidity : 0;
        }

        // Notify IncentiveController for loyalty tracking (before burn)
        if (address(incentiveController) != address(0)) {
            try incentiveController.onLiquidityRemoved(poolId, msg.sender, liquidity) {} catch {}
        }

        // Burn LP tokens
        VibeLP(lpToken).burn(msg.sender, liquidity);

        // Transfer tokens
        IERC20(pool.token0).safeTransfer(msg.sender, amount0);
        IERC20(pool.token1).safeTransfer(msg.sender, amount1);

        // Update TWAP oracle
        _updateOracle(poolId);

        emit LiquidityRemoved(poolId, msg.sender, amount0, amount1, liquidity);
    }

    /**
     * @notice Execute a batch of swaps with uniform clearing price
     * @param poolId Pool identifier
     * @param batchId Batch identifier
     * @param orders Array of swap orders
     * @return result Batch execution results
     */
    function executeBatchSwap(
        bytes32 poolId,
        uint64 batchId,
        SwapOrder[] calldata orders
    ) external nonReentrant onlyAuthorizedExecutor poolExists(poolId) whenNotGloballyPaused
      whenBreakerNotTripped(VOLUME_BREAKER) returns (
        BatchSwapResult memory result
    ) {
        if (orders.length == 0) {
            return BatchSwapResult({
                clearingPrice: 0,
                totalTokenInSwapped: 0,
                totalTokenOutSwapped: 0,
                protocolFees: 0
            });
        }

        Pool storage pool = pools[poolId];

        // Check for donation attacks before batch execution
        _checkDonationAttack(pool.token0);
        _checkDonationAttack(pool.token1);

        // Separate buy and sell orders for clearing price calculation
        (uint256[] memory buyOrders, uint256[] memory sellOrders) = _categorizeOrders(
            orders,
            pool.token0,
            pool.reserve0,
            pool.reserve1
        );

        // Calculate uniform clearing price
        (uint256 clearingPrice, ) = BatchMath.calculateClearingPrice(
            buyOrders,
            sellOrders,
            pool.reserve0,
            pool.reserve1
        );

        result.clearingPrice = clearingPrice;

        // Execute each order at clearing price
        for (uint256 i = 0; i < orders.length; i++) {
            SwapOrder calldata order = orders[i];

            (uint256 amountIn, uint256 amountOut, uint256 fee) = _executeSwap(
                pool,
                order,
                clearingPrice
            );

            result.totalTokenInSwapped += amountIn;
            result.totalTokenOutSwapped += amountOut;
            result.protocolFees += fee;
        }

        // Update circuit breaker with total volume
        _updateBreaker(VOLUME_BREAKER, result.totalTokenInSwapped);

        // Update TWAP oracle after batch
        _updateOracle(poolId);

        // Check price breaker after batch
        _checkAndUpdatePriceBreaker(poolId);

        // Sync tracked balances to prevent donation attack false positives on next batch
        trackedBalances[pool.token0] = IERC20(pool.token0).balanceOf(address(this));
        trackedBalances[pool.token1] = IERC20(pool.token1).balanceOf(address(this));

        emit BatchSwapExecuted(
            poolId,
            batchId,
            clearingPrice,
            orders.length,
            result.protocolFees
        );
    }

    /**
     * @notice Execute a single swap (for testing/direct access)
     * @param poolId Pool identifier
     * @param tokenIn Input token
     * @param amountIn Input amount
     * @param minAmountOut Minimum output
     * @param recipient Recipient address
     * @return amountOut Output amount
     */
    function swap(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external nonReentrant poolExists(poolId) noFlashLoan(poolId) whenNotGloballyPaused
      whenBreakerNotTripped(VOLUME_BREAKER) whenBreakerNotTripped(PRICE_BREAKER)
      validatePrice(poolId) returns (uint256 amountOut) {
        return _executeSwap(SwapParams(poolId, tokenIn, amountIn, minAmountOut, recipient));
    }

    /// @dev Internal swap implementation to avoid stack-too-deep
    function _executeSwap(SwapParams memory p) internal returns (uint256 amountOut) {
        Pool storage pool = pools[p.poolId];
        if (p.tokenIn != pool.token0 && p.tokenIn != pool.token1) revert InvalidToken();

        bool isToken0 = p.tokenIn == pool.token0;
        uint256 feeRate = pool.feeRate;

        // Calculate output with protections
        {
            uint256 reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
            uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;
            uint256 effResIn = reserveIn;
            uint256 effResOut = reserveOut;

            // Liquidity Protection
            if ((protectionFlags & FLAG_LIQUIDITY) != 0 && poolProtectionConfig[p.poolId].amplificationFactor > 0) {
                (uint256 adjustedFee, uint256 effRes0, uint256 effRes1) = _applyLiquidityProtection(
                    p.poolId, p.amountIn, _getTradeValueUsd(p.tokenIn, p.amountIn)
                );
                feeRate = adjustedFee;
                effResIn = isToken0 ? effRes0 : effRes1;
                effResOut = isToken0 ? effRes1 : effRes0;
                if (adjustedFee != pool.feeRate) emit DynamicFeeApplied(p.poolId, pool.feeRate, adjustedFee);
            }

            // Fibonacci Scaling
            if ((protectionFlags & FLAG_FIBONACCI) != 0) {
                feeRate = _applyFibonacciScaling(p.poolId, msg.sender, p.amountIn, feeRate);
            }

            // Trade size limit
            uint256 maxTradeSize = poolMaxTradeSize[p.poolId] > 0 ? poolMaxTradeSize[p.poolId] : (reserveIn * MAX_TRADE_SIZE_BPS) / 10000;
            if (p.amountIn > maxTradeSize) { emit LargeTradeLimited(p.poolId, p.amountIn, maxTradeSize); revert TradeTooLarge(maxTradeSize); }

            amountOut = BatchMath.getAmountOut(p.amountIn, effResIn, effResOut, feeRate);
            if (effResIn != reserveIn && amountOut > reserveOut * MAX_RESERVE_DRAIN_PERCENT / 100) amountOut = reserveOut * MAX_RESERVE_DRAIN_PERCENT / 100;
        }

        if (amountOut < p.minAmountOut) revert InsufficientOutput();

        // Execute transfers and update state
        _executeSwapTransfers(pool, p.tokenIn, isToken0, p.amountIn, amountOut, p.recipient);
        _updateSwapState(pool, p.poolId, p.tokenIn, isToken0, p.amountIn, amountOut, feeRate);
    }

    /**
     * @notice Execute a swap with proof-of-work for fee discount
     * @dev Users can reduce trading fees by submitting valid PoW proofs
     * @param params Bundled swap parameters (see PoWSwapParams struct)
     * @return amountOut Output amount
     */
    function swapWithPoW(PoWSwapParams calldata params) external nonReentrant
      poolExists(params.poolId) noFlashLoan(params.poolId) whenNotGloballyPaused
      whenBreakerNotTripped(VOLUME_BREAKER) whenBreakerNotTripped(PRICE_BREAKER)
      validatePrice(params.poolId) returns (uint256 amountOut) {
        return _executePoWSwap(params);
    }

    /// @dev Internal implementation for PoW swap to avoid stack-too-deep
    function _executePoWSwap(PoWSwapParams memory p) internal returns (uint256 amountOut) {
        Pool storage pool = pools[p.poolId];
        if (p.tokenIn != pool.token0 && p.tokenIn != pool.token1) revert InvalidToken();

        bool isToken0 = p.tokenIn == pool.token0;
        uint256 adjustedFeeRate = pool.feeRate;

        // Apply PoW discount
        if (p.claimedDifficulty > 0 && p.powNonce != bytes32(0)) {
            bytes32 challenge = ProofOfWorkLib.generateChallenge(msg.sender, 0, p.poolId);
            if (!ProofOfWorkLib.verify(
                ProofOfWorkLib.PoWProof({challenge: challenge, nonce: p.powNonce, algorithm: ProofOfWorkLib.Algorithm(p.powAlgorithm)}),
                p.claimedDifficulty
            )) revert InvalidPoWProof();
            bytes32 proofHash = ProofOfWorkLib.computeProofHash(challenge, p.powNonce);
            if (usedFeePoWProofs[proofHash]) revert PoWProofAlreadyUsed();
            usedFeePoWProofs[proofHash] = true;
            uint256 discount = ProofOfWorkLib.difficultyToFeeDiscount(p.claimedDifficulty, maxPoWFeeDiscount);
            adjustedFeeRate = adjustedFeeRate * (10000 - discount) / 10000;
            emit PoWFeeDiscountApplied(p.poolId, msg.sender, p.claimedDifficulty, discount);
        }

        // Calculate output with protections
        {
            uint256 reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
            uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;
            if ((protectionFlags & FLAG_LIQUIDITY) != 0 && poolProtectionConfig[p.poolId].amplificationFactor > 0) {
                (uint256 protectionFee, , ) = _applyLiquidityProtection(p.poolId, p.amountIn, _getTradeValueUsd(p.tokenIn, p.amountIn));
                if (protectionFee > adjustedFeeRate) adjustedFeeRate = protectionFee;
            }
            if ((protectionFlags & FLAG_FIBONACCI) != 0) {
                adjustedFeeRate = _applyFibonacciScaling(p.poolId, msg.sender, p.amountIn, adjustedFeeRate);
            }
            uint256 maxTradeSize = poolMaxTradeSize[p.poolId] > 0 ? poolMaxTradeSize[p.poolId] : (reserveIn * MAX_TRADE_SIZE_BPS) / 10000;
            if (p.amountIn > maxTradeSize) { emit LargeTradeLimited(p.poolId, p.amountIn, maxTradeSize); revert TradeTooLarge(maxTradeSize); }
            amountOut = BatchMath.getAmountOut(p.amountIn, reserveIn, reserveOut, adjustedFeeRate);
        }

        if (amountOut < p.minAmountOut) revert InsufficientOutput();

        // Execute swap
        _executeSwapTransfers(pool, p.tokenIn, isToken0, p.amountIn, amountOut, p.recipient);
        _updateSwapState(pool, p.poolId, p.tokenIn, isToken0, p.amountIn, amountOut, adjustedFeeRate);
    }

    /// @dev Internal helper to execute swap token transfers
    function _executeSwapTransfers(
        Pool storage pool,
        address tokenIn,
        bool isToken0,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    ) internal {
        address tokenOut = isToken0 ? pool.token1 : pool.token0;
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
    }

    /// @dev Internal helper to update state after swap
    function _updateSwapState(
        Pool storage pool,
        bytes32 poolId,
        address tokenIn,
        bool isToken0,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeRate
    ) internal {
        address tokenOut = isToken0 ? pool.token1 : pool.token0;

        // Calculate and track fees
        (uint256 protocolFee, ) = BatchMath.calculateFees(amountIn, feeRate, protocolFeeShare);

        // Route volatility fee surplus to IncentiveController for insurance pool
        // When dynamic fee > base fee, the protocol's share of the surplus goes to
        // VolatilityInsurancePool instead of the general treasury fee accumulator.
        // LP base fees remain untouched (they're in reserves via x*y=k).
        uint256 volatilitySurplus;
        if (address(incentiveController) != address(0) && feeRate > pool.feeRate && protocolFee > 0) {
            (uint256 basePFee, ) = BatchMath.calculateFees(amountIn, pool.feeRate, protocolFeeShare);
            volatilitySurplus = protocolFee > basePFee ? protocolFee - basePFee : 0;
            if (volatilitySurplus > 0) {
                // Base portion accumulates normally; surplus routes to incentive layer
                accumulatedFees[tokenIn] += protocolFee - volatilitySurplus;
                IERC20(tokenIn).safeTransfer(address(incentiveController), volatilitySurplus);
                try incentiveController.routeVolatilityFee(poolId, tokenIn, volatilitySurplus) {} catch {}
                emit VolatilityFeeRouted(poolId, tokenIn, volatilitySurplus);
            } else {
                accumulatedFees[tokenIn] += protocolFee;
            }
        } else {
            accumulatedFees[tokenIn] += protocolFee;
        }

        // Update reserves unchecked
        unchecked {
            if (isToken0) { pool.reserve0 += amountIn; pool.reserve1 -= amountOut; }
            else { pool.reserve1 += amountIn; pool.reserve0 -= amountOut; }
            trackedBalances[tokenIn] += amountIn;
            if (trackedBalances[tokenOut] >= amountOut) trackedBalances[tokenOut] -= amountOut;
        }

        // Update oracles and breakers
        _updateBreaker(VOLUME_BREAKER, amountIn);
        _checkAndUpdatePriceBreaker(poolId);
        _updateOracle(poolId);
        _updateVWAP(poolId, pool.reserve0 > 0 ? (pool.reserve1 * 1e18) / pool.reserve0 : 0, amountIn);

        emit SwapExecuted(poolId, msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    /**
     * @notice Collect accumulated protocol fees and send to treasury
     * @dev When protocolFeeShare > 0, a portion of trading fees accumulate here.
     *      Treasury (ProtocolFeeAdapter) forwards to FeeRouter for cooperative distribution.
     * @param token Token address to collect fees for
     */
    function collectFees(address token) external nonReentrant {
        if (msg.sender != treasury && msg.sender != owner()) revert NotAuthorized();
        uint256 amount = accumulatedFees[token];
        if (amount == 0) revert NoFeesToCollect();

        accumulatedFees[token] = 0;
        IERC20(token).safeTransfer(treasury, amount);

        emit FeesCollected(token, amount);
    }

    // ============ View Functions ============

    /**
     * @notice Get pool information
     */
    function getPool(bytes32 poolId) external view returns (Pool memory) {
        return pools[poolId];
    }

    /**
     * @notice Get pool ID for a token pair
     */
    function getPoolId(address tokenA, address tokenB) public pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        return keccak256(abi.encodePacked(token0, token1));
    }

    /**
     * @notice Quote output amount for a swap
     */
    function quote(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn
    ) external view poolExists(poolId) returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];

        bool isToken0 = tokenIn == pool.token0;
        uint256 reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
        uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;

        amountOut = BatchMath.getAmountOut(
            amountIn,
            reserveIn,
            reserveOut,
            pool.feeRate
        );
    }

    /**
     * @notice Get LP token address for a pool
     */
    function getLPToken(bytes32 poolId) external view returns (address) {
        return lpTokens[poolId];
    }

    /**
     * @notice Get spot price (token1 per token0)
     */
    function getSpotPrice(bytes32 poolId) external view poolExists(poolId) returns (uint256) {
        Pool storage pool = pools[poolId];
        if (pool.reserve0 == 0) return 0;
        return (pool.reserve1 * 1e18) / pool.reserve0;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set authorized executor
     */
    function setAuthorizedExecutor(
        address executor,
        bool authorized
    ) external onlyOwner {
        authorizedExecutors[executor] = authorized;
        emit AuthorizedExecutorUpdated(executor, authorized);
    }

    /**
     * @notice Update treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        if (_treasury == address(0)) revert InvalidTreasury();
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    /// @notice Set protocol fee share (portion of trading fees routed to treasury)
    /// @param share Fee share in BPS (0-2500). 0 = all fees to LPs, 2500 = 25% to protocol.
    function setProtocolFeeShare(uint256 share) external onlyOwner {
        if (share > 2500) revert("Fee share too high"); // Max 25%
        protocolFeeShare = share;
        emit ProtocolFeeShareUpdated(share);
    }

    // ============ Liquidity Protection Admin ============

    /**
     * @notice Enable/disable global liquidity protection
     * @dev Gas-optimized: uses packed uint8 flags
     */
    function setLiquidityProtection(bool enabled) external onlyOwner {
        if (enabled) {
            protectionFlags |= FLAG_LIQUIDITY;
        } else {
            protectionFlags &= ~FLAG_LIQUIDITY;
        }
        emit LiquidityProtectionToggled(enabled);
    }

    /**
     * @notice Configure liquidity protection for a specific pool
     * @param poolId Pool identifier
     * @param config Protection configuration
     */
    function setPoolProtectionConfig(
        bytes32 poolId,
        LiquidityProtection.ProtectionConfig calldata config
    ) external onlyOwner poolExists(poolId) {
        LiquidityProtection.validateConfig(config);
        poolProtectionConfig[poolId] = config;

        emit LiquidityProtectionConfigured(poolId, config.amplificationFactor, config.maxPriceImpactBps);
    }

    /**
     * @notice Set default protection config for a pool
     * @param poolId Pool identifier
     * @param isStablePair Whether this is a stablecoin pair
     */
    function setDefaultProtectionConfig(bytes32 poolId, bool isStablePair) external onlyOwner poolExists(poolId) {
        if (isStablePair) {
            poolProtectionConfig[poolId] = LiquidityProtection.getStablePairConfig();
        } else {
            poolProtectionConfig[poolId] = LiquidityProtection.getDefaultConfig();
        }

        emit LiquidityProtectionConfigured(
            poolId,
            poolProtectionConfig[poolId].amplificationFactor,
            poolProtectionConfig[poolId].maxPriceImpactBps
        );
    }

    /**
     * @notice Update token USD price (called by keeper/oracle)
     * @param token Token address
     * @param priceUsd Price in USD (18 decimals)
     */
    function updateTokenPrice(address token, uint256 priceUsd) external {
        if (msg.sender != owner() && msg.sender != priceOracle) revert NotAuthorized();
        tokenUsdPrices[token] = priceUsd;
        emit TokenPriceUpdated(token, priceUsd);
    }

    /**
     * @notice Set price oracle address
     */
    function setPriceOracle(address oracle) external onlyOwner {
        require(oracle != address(0), "Invalid oracle");
        priceOracle = oracle;
        emit PriceOracleUpdated(oracle);
    }

    /**
     * @notice Set priority registry for recording pool creation pioneers
     */
    function setPriorityRegistry(address _registry) external onlyOwner {
        priorityRegistry = IPriorityRegistry(_registry);
        emit PriorityRegistryUpdated(_registry);
    }

    /**
     * @notice Set the IncentiveController for LP lifecycle hooks and fee routing
     * @param _controller IncentiveController proxy address (or address(0) to disable)
     */
    function setIncentiveController(address _controller) external onlyOwner {
        incentiveController = IIncentiveController(_controller);
        emit IncentiveControllerUpdated(_controller);
    }

    /**
     * @notice Grow VWAP oracle cardinality for longer windows
     */
    function growVWAPCardinality(bytes32 poolId, uint16 newCardinality) external onlyOwner {
        poolVWAP[poolId].grow(newCardinality);
        emit VWAPCardinalityGrown(poolId, newCardinality);
    }

    // ============ Internal Functions ============

    /**
     * @notice Categorize orders into buy/sell for clearing price calculation
     */
    function _categorizeOrders(
        SwapOrder[] calldata orders,
        address token0,
        uint256 reserve0,
        uint256 reserve1
    ) internal pure returns (
        uint256[] memory buyOrders,
        uint256[] memory sellOrders
    ) {
        // Count buys and sells
        uint256 buyCount = 0;
        uint256 sellCount = 0;

        for (uint256 i = 0; i < orders.length; i++) {
            if (orders[i].tokenIn == token0) {
                sellCount++;
            } else {
                buyCount++;
            }
        }

        buyOrders = new uint256[](buyCount * 2);
        sellOrders = new uint256[](sellCount * 2);

        uint256 buyIdx = 0;
        uint256 sellIdx = 0;

        uint256 spotPrice = reserve0 > 0 ? (reserve1 * 1e18) / reserve0 : 0;

        for (uint256 i = 0; i < orders.length; i++) {
            if (orders[i].tokenIn == token0) {
                // Selling token0 for token1
                uint256 minPrice = orders[i].amountIn > 0
                    ? (orders[i].minAmountOut * 1e18) / orders[i].amountIn
                    : 0;
                sellOrders[sellIdx] = orders[i].amountIn;
                sellOrders[sellIdx + 1] = minPrice;
                sellIdx += 2;
            } else {
                // Buying token0 with token1
                uint256 maxPrice = orders[i].minAmountOut > 0
                    ? (orders[i].amountIn * 1e18) / orders[i].minAmountOut
                    : spotPrice * 2;
                buyOrders[buyIdx] = orders[i].amountIn;
                buyOrders[buyIdx + 1] = maxPrice;
                buyIdx += 2;
            }
        }
    }

    /**
     * @notice Execute a single swap at clearing price
     */
    function _executeSwap(
        Pool storage pool,
        SwapOrder calldata order,
        uint256 clearingPrice
    ) internal returns (
        uint256 amountIn,
        uint256 amountOut,
        uint256 protocolFee
    ) {
        bool isToken0 = order.tokenIn == pool.token0;
        address tokenOut = isToken0 ? pool.token1 : pool.token0;

        amountIn = order.amountIn;

        // Calculate output at clearing price
        if (isToken0) {
            // Selling token0: amountOut = amountIn * clearingPrice / 1e18
            amountOut = (amountIn * clearingPrice) / 1e18;
        } else {
            // Buying token0: amountOut = amountIn * 1e18 / clearingPrice
            amountOut = clearingPrice > 0 ? (amountIn * 1e18) / clearingPrice : 0;
        }

        // Apply fee - deduct from output
        (protocolFee, ) = BatchMath.calculateFees(
            amountOut,
            pool.feeRate,
            protocolFeeShare
        );

        // Reduce output by fee
        uint256 totalFee = (amountOut * pool.feeRate) / 10000;
        amountOut = amountOut - totalFee;

        // Check minimum output after fees
        if (amountOut < order.minAmountOut) {
            // FIX #5: Emit failure event instead of silent return
            emit SwapFailed(
                getPoolId(pool.token0, pool.token1),
                order.trader,
                order.tokenIn,
                amountIn,
                amountOut,
                order.minAmountOut,
                "Slippage exceeded"
            );
            // FIX #6: Return unfilled tokens to CALLER (VibeSwapCore), not trader
            // VibeSwapCore manages deposit accounting and handles refunds to traders
            IERC20(order.tokenIn).safeTransfer(msg.sender, amountIn);
            return (0, 0, 0);
        }

        // Verify we have enough output tokens (including LP fee deduction)
        uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;
        uint256 reserveDeduction = amountOut + totalFee - protocolFee;
        if (reserveDeduction > reserveOut) {
            // FIX #5: Emit failure event
            emit SwapFailed(
                getPoolId(pool.token0, pool.token1),
                order.trader,
                order.tokenIn,
                amountIn,
                amountOut,
                order.minAmountOut,
                "Insufficient liquidity"
            );
            // FIX #6: Return unfilled tokens to CALLER (VibeSwapCore), not trader
            IERC20(order.tokenIn).safeTransfer(msg.sender, amountIn);
            return (0, 0, 0);
        }

        // Transfer output tokens to trader
        IERC20(tokenOut).safeTransfer(order.trader, amountOut);

        // Update reserves (input tokens are already in contract)
        if (isToken0) {
            pool.reserve0 += amountIn;
            pool.reserve1 -= (amountOut + totalFee - protocolFee); // LP fees stay in pool
        } else {
            pool.reserve1 += amountIn;
            pool.reserve0 -= (amountOut + totalFee - protocolFee);
        }

        // Track protocol fees (from output token, not input)
        accumulatedFees[tokenOut] += protocolFee;

        emit SwapExecuted(
            getPoolId(pool.token0, pool.token1),
            order.trader,
            order.tokenIn,
            tokenOut,
            amountIn,
            amountOut
        );
    }

    // ============ Security Internal Functions ============

    /**
     * @notice Update TWAP oracle for a pool
     */
    function _updateOracle(bytes32 poolId) internal {
        Pool storage pool = pools[poolId];
        if (pool.reserve0 > 0) {
            uint256 spotPrice = (pool.reserve1 * 1e18) / pool.reserve0;
            poolOracles[poolId].write(spotPrice);
        }
    }

    /**
     * @notice Update VWAP oracle with trade data
     */
    function _updateVWAP(bytes32 poolId, uint256 price, uint256 volume) internal {
        poolVWAP[poolId].recordTrade(price, volume);
    }

    /**
     * @notice Apply Fibonacci-based scaling for throughput and fees
     * @param poolId Pool identifier
     * @param user User address
     * @param amountIn Trade amount
     * @param currentFee Current fee rate
     * @return adjustedFee Fibonacci-adjusted fee rate
     */
    function _applyFibonacciScaling(
        bytes32 poolId,
        address user,
        uint256 amountIn,
        uint256 currentFee
    ) internal returns (uint256 adjustedFee) {
        // Reset volume window if expired
        if (block.timestamp > userVolumeWindowStart[user] + fibonacciWindowDuration) {
            userVolumeWindowStart[user] = block.timestamp;
            userPoolVolume[user][poolId] = 0;
        }

        uint256 currentVolume = userPoolVolume[user][poolId];
        uint256 baseUnit = fibonacciBaseUnit[poolId];
        if (baseUnit == 0) {
            baseUnit = 1 ether; // Default 1 ETH base unit
        }

        // Get current tier and check rate limit
        (uint8 tier, uint256 maxAllowed, ) = FibonacciScaling.getThroughputTier(
            currentVolume + amountIn,
            baseUnit
        );

        // Calculate rate limit
        uint256 maxBandwidth = FibonacciScaling.fibonacciSum(tier + 5) * baseUnit;
        (uint256 allowedAmount, uint256 cooldownSeconds) = FibonacciScaling.calculateRateLimit(
            currentVolume,
            maxBandwidth,
            fibonacciWindowDuration
        );

        if (amountIn > allowedAmount && allowedAmount < amountIn) {
            revert FibonacciRateLimitExceeded(amountIn, allowedAmount, cooldownSeconds);
        }

        // Apply Fibonacci fee multiplier based on tier
        adjustedFee = FibonacciScaling.getFibonacciFeeMultiplier(tier, currentFee);

        // Update user volume
        userPoolVolume[user][poolId] = currentVolume + amountIn;

        // Emit tier event if significant
        if (tier > 0) {
            emit FibonacciTierReached(poolId, user, tier, currentVolume + amountIn);
        }

        // Emit fee event if adjusted
        if (adjustedFee != currentFee) {
            emit FibonacciFeeApplied(poolId, currentFee, adjustedFee, tier);
        }

        // Update high/low prices for Fib retracement
        _updateFibonacciPriceLevels(poolId);
    }

    /**
     * @notice Update high/low prices and detect Fibonacci levels
     */
    function _updateFibonacciPriceLevels(bytes32 poolId) internal {
        Pool storage pool = pools[poolId];
        if (pool.reserve0 == 0) return;

        uint256 currentPrice = (pool.reserve1 * 1e18) / pool.reserve0;

        // Update high/low
        if (currentPrice > recentHighPrice[poolId] || recentHighPrice[poolId] == 0) {
            recentHighPrice[poolId] = currentPrice;
        }
        if (currentPrice < recentLowPrice[poolId] || recentLowPrice[poolId] == 0) {
            recentLowPrice[poolId] = currentPrice;
        }

        // Detect Fibonacci level (with 1% tolerance)
        if (recentHighPrice[poolId] > recentLowPrice[poolId]) {
            (uint256 level, bool isSupport) = FibonacciScaling.detectFibonacciLevel(
                currentPrice,
                recentHighPrice[poolId],
                recentLowPrice[poolId],
                100 // 1% tolerance
            );

            if (level != 9999) {
                emit FibonacciPriceLevelDetected(poolId, currentPrice, level, isSupport);
            }
        }
    }

    /**
     * @notice Get pool liquidity metrics for protection calculations
     */
    function _getPoolMetrics(bytes32 poolId) internal view returns (LiquidityProtection.LiquidityMetrics memory metrics) {
        Pool storage pool = pools[poolId];

        metrics.reserve0 = pool.reserve0;
        metrics.reserve1 = pool.reserve1;

        // Calculate USD value of liquidity
        uint256 price0 = tokenUsdPrices[pool.token0];
        uint256 price1 = tokenUsdPrices[pool.token1];

        if (price0 > 0 && price1 > 0) {
            metrics.totalValueUsd = (pool.reserve0 * price0 / 1e18) + (pool.reserve1 * price1 / 1e18);
        } else {
            // Fallback: estimate based on reserves (assumes 1:1 for unknown tokens)
            metrics.totalValueUsd = pool.reserve0 + pool.reserve1;
        }

        // Concentration score (simplified - could be more sophisticated)
        metrics.concentrationScore = 50; // Default medium concentration

        // Utilization rate from VWAP volume data
        if (poolVWAP[poolId].cardinality > 0 && metrics.totalValueUsd > 0) {
            (, uint128 volumeCumulative) = poolVWAP[poolId].getCurrentCumulatives();
            metrics.utilizationRate = (uint256(volumeCumulative) * 1e18) / metrics.totalValueUsd;
        }
    }

    /**
     * @notice Apply liquidity protection checks and get adjusted parameters
     */
    function _applyLiquidityProtection(
        bytes32 poolId,
        uint256 amountIn,
        uint256 tradeValueUsd
    ) internal view returns (uint256 adjustedFee, uint256 effectiveReserve0, uint256 effectiveReserve1) {
        if ((protectionFlags & FLAG_LIQUIDITY) == 0) {
            Pool storage pool = pools[poolId];
            return (pool.feeRate, pool.reserve0, pool.reserve1);
        }

        LiquidityProtection.ProtectionConfig storage config = poolProtectionConfig[poolId];

        // If no config set, use defaults
        if (config.amplificationFactor == 0) {
            Pool storage pool = pools[poolId];
            return (pool.feeRate, pool.reserve0, pool.reserve1);
        }

        LiquidityProtection.LiquidityMetrics memory metrics = _getPoolMetrics(poolId);

        // Apply all protections
        (adjustedFee, effectiveReserve0, effectiveReserve1) = LiquidityProtection.applyProtections(
            config,
            metrics,
            amountIn,
            tradeValueUsd
        );
    }

    /**
     * @notice Calculate trade value in USD
     */
    function _getTradeValueUsd(address token, uint256 amount) internal view returns (uint256) {
        uint256 price = tokenUsdPrices[token];
        if (price == 0) return amount; // Fallback: assume 1:1
        return (amount * price) / 1e18;
    }

    /**
     * @notice Validate current price against TWAP
     */
    function _validatePriceAgainstTWAP(bytes32 poolId) internal view {
        Pool storage pool = pools[poolId];
        if (pool.reserve0 == 0) return;

        uint256 spotPrice = (pool.reserve1 * 1e18) / pool.reserve0;

        // Check if we have enough history for TWAP
        if (!poolOracles[poolId].canConsult(DEFAULT_TWAP_PERIOD)) {
            return; // Not enough history, skip validation
        }

        uint256 twapPrice = poolOracles[poolId].consult(DEFAULT_TWAP_PERIOD);

        if (!SecurityLib.checkPriceDeviation(spotPrice, twapPrice, MAX_PRICE_DEVIATION_BPS)) {
            revert PriceDeviationTooHigh(spotPrice, twapPrice);
        }
    }

    /**
     * @notice Check for donation attack (unexpected balance increase)
     */
    function _checkDonationAttack(address token) internal {
        uint256 actualBalance = IERC20(token).balanceOf(address(this));
        uint256 tracked = trackedBalances[token];

        // Skip if no tracked balance yet (first interaction)
        if (tracked == 0) return;

        // Check if actual balance differs significantly from tracked
        if (!SecurityLib.checkBalanceConsistency(tracked, actualBalance, MAX_DONATION_BPS)) {
            emit DonationAttackDetected(token, tracked, actualBalance);
            revert DonationAttackSuspected();
        }
    }

    /**
     * @notice Check and update price breaker
     */
    function _checkAndUpdatePriceBreaker(bytes32 poolId) internal {
        Pool storage pool = pools[poolId];
        if (pool.reserve0 == 0) return;

        uint256 spotPrice = (pool.reserve1 * 1e18) / pool.reserve0;

        // Get TWAP if available
        if (poolOracles[poolId].cardinality >= 2 && poolOracles[poolId].canConsult(DEFAULT_TWAP_PERIOD)) {
            uint256 twapPrice = poolOracles[poolId].consult(DEFAULT_TWAP_PERIOD);

            // Calculate deviation in basis points
            uint256 deviation;
            if (spotPrice > twapPrice) {
                deviation = ((spotPrice - twapPrice) * 10000) / twapPrice;
            } else {
                deviation = ((twapPrice - spotPrice) * 10000) / twapPrice;
            }

            // Update price breaker with deviation
            if (_updateBreaker(PRICE_BREAKER, deviation)) {
                emit PriceManipulationDetected(poolId, spotPrice, twapPrice);
            }
        }
    }

    // ============ Security Admin Functions ============

    /**
     * @notice Enable/disable flash loan protection
     * @dev Gas-optimized: uses packed uint8 flags
     */
    function setFlashLoanProtection(bool enabled) external onlyOwner {
        if (enabled) {
            protectionFlags |= FLAG_FLASH_LOAN;
        } else {
            protectionFlags &= ~FLAG_FLASH_LOAN;
        }
        emit FlashLoanProtectionToggled(enabled);
    }

    /**
     * @notice Enable/disable TWAP validation
     * @dev Gas-optimized: uses packed uint8 flags
     */
    function setTWAPValidation(bool enabled) external onlyOwner {
        if (enabled) {
            protectionFlags |= FLAG_TWAP;
        } else {
            protectionFlags &= ~FLAG_TWAP;
        }
        emit TWAPValidationToggled(enabled);
    }

    /// @notice Check if flash loan protection is enabled
    function flashLoanProtectionEnabled() public view returns (bool) {
        return (protectionFlags & FLAG_FLASH_LOAN) != 0;
    }

    /// @notice Check if TWAP validation is enabled
    function twapValidationEnabled() public view returns (bool) {
        return (protectionFlags & FLAG_TWAP) != 0;
    }

    /// @notice Check if true price validation is enabled
    function truePriceValidationEnabled() public view returns (bool) {
        return (protectionFlags & FLAG_TRUE_PRICE) != 0;
    }

    /// @notice Check if liquidity protection is enabled
    function liquidityProtectionEnabled() public view returns (bool) {
        return (protectionFlags & FLAG_LIQUIDITY) != 0;
    }

    /// @notice Check if Fibonacci scaling is enabled
    function fibonacciScalingEnabled() public view returns (bool) {
        return (protectionFlags & FLAG_FIBONACCI) != 0;
    }

    /**
     * @notice Set custom max trade size for a pool
     */
    function setPoolMaxTradeSize(bytes32 poolId, uint256 maxSize) external onlyOwner {
        poolMaxTradeSize[poolId] = maxSize;
        emit PoolMaxTradeSizeUpdated(poolId, maxSize);
    }

    /**
     * @notice Grow oracle cardinality for longer TWAP windows
     */
    function growOracleCardinality(bytes32 poolId, uint16 newCardinality) external onlyOwner {
        poolOracles[poolId].grow(newCardinality);
        emit OracleCardinalityGrown(poolId, newCardinality);
    }

    /**
     * @notice Sync tracked balance with actual balance (admin recovery)
     */
    function syncTrackedBalance(address token) external onlyOwner {
        trackedBalances[token] = IERC20(token).balanceOf(address(this));
        emit TrackedBalanceSynced(token, trackedBalances[token]);
    }

    // ============ Security View Functions ============

    /**
     * @notice Get TWAP price for a pool
     */
    function getTWAP(bytes32 poolId, uint32 period) external view returns (uint256) {
        if (!poolOracles[poolId].canConsult(period)) {
            return 0;
        }
        return poolOracles[poolId].consult(period);
    }

    /**
     * @notice Check if pool has sufficient oracle history
     */
    function hasOracleHistory(bytes32 poolId, uint32 period) external view returns (bool) {
        return poolOracles[poolId].canConsult(period);
    }

    /**
     * @notice Get oracle cardinality for a pool
     */
    function getOracleCardinality(bytes32 poolId) external view returns (uint16 current, uint16 next) {
        return (poolOracles[poolId].cardinality, poolOracles[poolId].cardinalityNext);
    }

    // ============ VWAP & Protection View Functions ============

    /**
     * @notice Get VWAP price for a pool
     * @param poolId Pool identifier
     * @param period VWAP period in seconds
     * @return vwap Volume-weighted average price
     */
    function getVWAP(bytes32 poolId, uint32 period) external view returns (uint256 vwap) {
        if (!poolVWAP[poolId].canConsult(period)) {
            return 0;
        }
        return poolVWAP[poolId].consult(period);
    }

    /**
     * @notice Get VWAP with volume info
     * @param poolId Pool identifier
     * @param period VWAP period in seconds
     * @return vwap Volume-weighted average price
     * @return volume Total volume in period
     */
    function getVWAPWithVolume(bytes32 poolId, uint32 period) external view returns (uint256 vwap, uint256 volume) {
        if (!poolVWAP[poolId].canConsult(period)) {
            return (0, 0);
        }
        return poolVWAP[poolId].consultWithVolume(period);
    }

    /**
     * @notice Check if VWAP is available for period
     */
    function hasVWAPHistory(bytes32 poolId, uint32 period) external view returns (bool) {
        return poolVWAP[poolId].canConsult(period);
    }

    /**
     * @notice Get liquidity score for a pool (0-100, higher = safer)
     */
    function getLiquidityScore(bytes32 poolId) external view returns (uint256 score) {
        LiquidityProtection.LiquidityMetrics memory metrics = _getPoolMetrics(poolId);
        return LiquidityProtection.calculateLiquidityScore(metrics);
    }

    /**
     * @notice Get pool liquidity in USD
     */
    function getPoolLiquidityUsd(bytes32 poolId) external view returns (uint256) {
        LiquidityProtection.LiquidityMetrics memory metrics = _getPoolMetrics(poolId);
        return metrics.totalValueUsd;
    }

    /**
     * @notice Get maximum trade size for given price impact
     * @param poolId Pool identifier
     * @param maxImpactBps Maximum acceptable price impact in basis points
     * @return maxAmountIn Maximum input amount
     */
    function getMaxTradeSizeForImpact(bytes32 poolId, uint256 maxImpactBps) external view returns (uint256 maxAmountIn) {
        Pool storage pool = pools[poolId];
        return LiquidityProtection.getMaxTradeSize(pool.reserve0, maxImpactBps);
    }

    /**
     * @notice Get effective fee rate after liquidity adjustments
     * @param poolId Pool identifier
     * @param amountIn Proposed trade size
     * @return fee Effective fee in basis points
     */
    function getEffectiveFee(bytes32 poolId, uint256 amountIn) external view returns (uint256 fee) {
        Pool storage pool = pools[poolId];

        if ((protectionFlags & FLAG_LIQUIDITY) == 0 || poolProtectionConfig[poolId].amplificationFactor == 0) {
            return pool.feeRate;
        }

        LiquidityProtection.LiquidityMetrics memory metrics = _getPoolMetrics(poolId);
        uint256 tradeValueUsd = _getTradeValueUsd(pool.token0, amountIn);

        return LiquidityProtection.calculateDynamicFee(
            metrics.totalValueUsd,
            tradeValueUsd,
            pool.feeRate
        );
    }

    // ============ Fibonacci Scaling Admin Functions ============

    /**
     * @notice Enable/disable Fibonacci scaling
     * @dev Gas-optimized: uses packed uint8 flags
     */
    function setFibonacciScaling(bool enabled) external onlyOwner {
        if (enabled) {
            protectionFlags |= FLAG_FIBONACCI;
        } else {
            protectionFlags &= ~FLAG_FIBONACCI;
        }
        emit FibonacciScalingToggled(enabled);
    }

    /**
     * @notice Set Fibonacci base unit for a pool
     * @param poolId Pool identifier
     * @param baseUnit Base unit for tier calculation
     */
    function setFibonacciBaseUnit(bytes32 poolId, uint256 baseUnit) external onlyOwner {
        if (baseUnit == 0) revert InvalidBaseUnit();
        fibonacciBaseUnit[poolId] = baseUnit;
        emit FibonacciBaseUnitUpdated(poolId, baseUnit);
    }

    /**
     * @notice Set Fibonacci volume window duration
     * @param duration Window duration in seconds
     */
    function setFibonacciWindowDuration(uint256 duration) external onlyOwner {
        if (duration < 1 minutes || duration > 24 hours) revert InvalidDuration();
        fibonacciWindowDuration = duration;
        emit FibonacciWindowDurationUpdated(duration);
    }

    /**
     * @notice Reset high/low prices for Fibonacci retracement
     * @param poolId Pool identifier
     */
    function resetFibonacciPriceLevels(bytes32 poolId) external onlyOwner {
        Pool storage pool = pools[poolId];
        if (pool.reserve0 > 0) {
            uint256 currentPrice = (pool.reserve1 * 1e18) / pool.reserve0;
            recentHighPrice[poolId] = currentPrice;
            recentLowPrice[poolId] = currentPrice;
        }
        emit FibonacciPriceLevelsReset(poolId);
    }

    // ============ Proof-of-Work Admin Functions ============

    /**
     * @notice Set maximum fee discount from PoW
     * @param _maxDiscount Maximum discount in basis points (e.g., 5000 = 50%)
     */
    function setMaxPoWFeeDiscount(uint256 _maxDiscount) external onlyOwner {
        if (_maxDiscount > 10000) revert InvalidDiscount();
        maxPoWFeeDiscount = _maxDiscount;
        emit MaxPoWFeeDiscountUpdated(_maxDiscount);
    }

    // ============ Fibonacci Scaling View Functions ============

    /**
     * @notice Get user's current Fibonacci tier for a pool
     * @param user User address
     * @param poolId Pool identifier
     * @return tier Current tier
     * @return volume Current volume in window
     * @return maxAllowed Maximum allowed for current tier
     */
    function getUserFibonacciTier(
        address user,
        bytes32 poolId
    ) external view returns (uint8 tier, uint256 volume, uint256 maxAllowed) {
        // Check if window is expired
        if (block.timestamp > userVolumeWindowStart[user] + fibonacciWindowDuration) {
            return (0, 0, fibonacciBaseUnit[poolId] > 0 ? fibonacciBaseUnit[poolId] : 1 ether);
        }

        volume = userPoolVolume[user][poolId];
        uint256 baseUnit = fibonacciBaseUnit[poolId] > 0 ? fibonacciBaseUnit[poolId] : 1 ether;

        (tier, maxAllowed, ) = FibonacciScaling.getThroughputTier(volume, baseUnit);
    }

    /**
     * @notice Get Fibonacci retracement levels for a pool
     * @param poolId Pool identifier
     * @return levels All Fibonacci retracement levels
     */
    function getFibonacciRetracementLevels(
        bytes32 poolId
    ) external view returns (FibonacciScaling.FibRetracementLevels memory levels) {
        uint256 high = recentHighPrice[poolId];
        uint256 low = recentLowPrice[poolId];

        if (high > 0 && low > 0 && high >= low) {
            return FibonacciScaling.calculateRetracementLevels(high, low);
        }

        // Return current price as all levels if no history
        Pool storage pool = pools[poolId];
        if (pool.reserve0 > 0) {
            uint256 currentPrice = (pool.reserve1 * 1e18) / pool.reserve0;
            levels.level0 = currentPrice;
            levels.level236 = currentPrice;
            levels.level382 = currentPrice;
            levels.level500 = currentPrice;
            levels.level618 = currentPrice;
            levels.level786 = currentPrice;
            levels.level1000 = currentPrice;
        }
    }

    /**
     * @notice Get Fibonacci price bands for a pool
     * @param poolId Pool identifier
     * @param volatilityBps Volatility in basis points (e.g., 500 for 5%)
     * @return bands Support and resistance levels
     */
    function getFibonacciPriceBands(
        bytes32 poolId,
        uint256 volatilityBps
    ) external view returns (FibonacciScaling.FibPriceBand memory bands) {
        Pool storage pool = pools[poolId];
        if (pool.reserve0 == 0) return bands;

        uint256 currentPrice = (pool.reserve1 * 1e18) / pool.reserve0;
        return FibonacciScaling.calculatePriceBands(currentPrice, volatilityBps);
    }

    /**
     * @notice Calculate Fibonacci-weighted price from recent trades
     * @dev Uses VWAP observations weighted by Fibonacci sequence
     * @param poolId Pool identifier
     * @return weightedPrice Fibonacci-weighted average price
     */
    function getFibonacciWeightedPrice(bytes32 poolId) external view returns (uint256 weightedPrice) {
        // Get recent prices from TWAP oracle
        if (!poolOracles[poolId].canConsult(5 minutes)) {
            Pool storage pool = pools[poolId];
            return pool.reserve0 > 0 ? (pool.reserve1 * 1e18) / pool.reserve0 : 0;
        }

        // Use TWAP as approximation (full implementation would use observation array)
        return poolOracles[poolId].consult(5 minutes);
    }

    /**
     * @notice Get Fibonacci liquidity score for a pool
     * @param poolId Pool identifier
     * @return score Liquidity score (0-100) based on Fibonacci bands
     */
    function getFibonacciLiquidityScore(bytes32 poolId) external view returns (uint256 score) {
        Pool storage pool = pools[poolId];
        if (pool.reserve0 == 0) return 0;

        uint256 currentPrice = (pool.reserve1 * 1e18) / pool.reserve0;
        uint256 priceRange = recentHighPrice[poolId] > recentLowPrice[poolId]
            ? recentHighPrice[poolId] - recentLowPrice[poolId]
            : currentPrice / 10; // Default 10% range

        return FibonacciScaling.calculateFibLiquidityScore(
            pool.reserve0 + pool.reserve1,
            currentPrice,
            priceRange
        );
    }

    /**
     * @notice Get golden ratio mean between bid and ask
     * @param poolId Pool identifier
     * @param bidPrice Bid price
     * @param askPrice Ask price
     * @return goldenMean Price at golden ratio point
     */
    function getGoldenRatioPrice(
        bytes32 poolId,
        uint256 bidPrice,
        uint256 askPrice
    ) external pure returns (uint256 goldenMean) {
        return FibonacciScaling.goldenRatioMean(bidPrice, askPrice);
    }
}
