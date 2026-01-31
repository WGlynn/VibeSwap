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

    // ============ Constants ============

    /// @notice Default fee rate (0.3%)
    uint256 public constant DEFAULT_FEE_RATE = 30;

    /// @notice Protocol's share of fees (20% of total fees)
    uint256 public constant PROTOCOL_FEE_SHARE = 2000;

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

    // ============ State ============

    /// @notice Mapping of pool ID to pool data
    mapping(bytes32 => Pool) public pools;

    /// @notice Mapping of pool ID to LP token address
    mapping(bytes32 => address) public lpTokens;

    /// @notice Mapping of pool ID to user to LP balance (backup tracking)
    mapping(bytes32 => mapping(address => uint256)) public liquidityBalance;

    /// @notice DAO treasury for protocol fees
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

    /// @notice Whether flash loan protection is enabled
    bool public flashLoanProtectionEnabled;

    /// @notice Whether TWAP validation is enabled
    bool public twapValidationEnabled;

    /// @notice Custom max trade size per pool (0 = use default)
    mapping(bytes32 => uint256) public poolMaxTradeSize;

    // ============ Security Events ============

    event FlashLoanAttemptBlocked(address indexed user, bytes32 indexed poolId);
    event PriceManipulationDetected(bytes32 indexed poolId, uint256 spotPrice, uint256 twapPrice);
    event DonationAttackDetected(address indexed token, uint256 tracked, uint256 actual);
    event LargeTradeLimited(bytes32 indexed poolId, uint256 requested, uint256 allowed);

    // ============ Security Errors ============

    error FlashLoanDetected();
    error PriceDeviationTooHigh(uint256 spotPrice, uint256 twapPrice);
    error SameBlockInteraction();
    error TradeTooLarge(uint256 maxAllowed);
    error DonationAttackSuspected();

    // ============ Modifiers ============

    modifier onlyAuthorizedExecutor() {
        require(authorizedExecutors[msg.sender], "Not authorized");
        _;
    }

    modifier poolExists(bytes32 poolId) {
        require(pools[poolId].initialized, "Pool does not exist");
        _;
    }

    /// @notice Prevents flash loan attacks by blocking same-block interactions
    modifier noFlashLoan(bytes32 poolId) {
        if (flashLoanProtectionEnabled) {
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
        if (twapValidationEnabled && poolOracles[poolId].cardinality >= 2) {
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

        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;

        // Enable security features by default
        flashLoanProtectionEnabled = true;
        twapValidationEnabled = true;

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
        require(token0 != address(0) && token1 != address(0), "Invalid token");
        require(token0 != token1, "Identical tokens");

        // Ensure consistent ordering
        (token0, token1) = token0 < token1 ? (token0, token1) : (token1, token0);

        poolId = getPoolId(token0, token1);
        require(!pools[poolId].initialized, "Pool exists");

        uint256 actualFeeRate = feeRate == 0 ? DEFAULT_FEE_RATE : feeRate;
        require(actualFeeRate <= 1000, "Fee too high"); // Max 10%

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
        _checkDonationAttack(pool.token0, pool.reserve0);
        _checkDonationAttack(pool.token1, pool.reserve1);

        // Calculate optimal amounts
        (amount0, amount1) = BatchMath.calculateOptimalLiquidity(
            amount0Desired,
            amount1Desired,
            pool.reserve0,
            pool.reserve1
        );

        require(amount0 >= amount0Min, "Insufficient token0");
        require(amount1 >= amount1Min, "Insufficient token1");

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
            require(liquidity > MINIMUM_LIQUIDITY, "Initial liquidity too low");
            // Burn minimum liquidity to dead address (prevents share manipulation)
            liquidity -= MINIMUM_LIQUIDITY;
            VibeLP(lpTokens[poolId]).mint(address(0xdead), MINIMUM_LIQUIDITY);
            pool.totalLiquidity += MINIMUM_LIQUIDITY;

            // Initialize TWAP oracle for this pool
            uint256 initialPrice = amount0 > 0 ? (amount1 * 1e18) / amount0 : 0;
            poolOracles[poolId].initialize(initialPrice);
        }

        require(liquidity > 0, "Insufficient liquidity minted");

        // Update reserves
        pool.reserve0 += amount0;
        pool.reserve1 += amount1;
        pool.totalLiquidity += liquidity;

        // Update tracked balances for donation detection
        trackedBalances[pool.token0] += amount0;
        trackedBalances[pool.token1] += amount1;

        // Update TWAP oracle
        _updateOracle(poolId);

        // Mint LP tokens
        VibeLP(lpTokens[poolId]).mint(msg.sender, liquidity);
        liquidityBalance[poolId][msg.sender] += liquidity;

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

        require(liquidity > 0, "Invalid liquidity");
        require(pool.totalLiquidity >= liquidity, "Insufficient liquidity");

        // Verify user has the LP tokens (check actual balance, not internal tracking)
        require(IERC20(lpToken).balanceOf(msg.sender) >= liquidity, "Insufficient LP balance");

        // Calculate amounts
        amount0 = (liquidity * pool.reserve0) / pool.totalLiquidity;
        amount1 = (liquidity * pool.reserve1) / pool.totalLiquidity;

        require(amount0 >= amount0Min, "Insufficient token0 output");
        require(amount1 >= amount1Min, "Insufficient token1 output");

        // Check withdrawal circuit breaker (percentage of TVL)
        uint256 withdrawalValueBps = pool.totalLiquidity > 0
            ? (liquidity * 10000) / pool.totalLiquidity
            : 0;
        _updateBreaker(WITHDRAWAL_BREAKER, withdrawalValueBps);

        // Update state before external calls (CEI pattern)
        pool.reserve0 -= amount0;
        pool.reserve1 -= amount1;
        pool.totalLiquidity -= liquidity;

        // Update tracked balances
        if (trackedBalances[pool.token0] >= amount0) {
            trackedBalances[pool.token0] -= amount0;
        }
        if (trackedBalances[pool.token1] >= amount1) {
            trackedBalances[pool.token1] -= amount1;
        }

        // Update internal tracking (use min to prevent underflow if LP was transferred)
        uint256 tracked = liquidityBalance[poolId][msg.sender];
        liquidityBalance[poolId][msg.sender] = tracked >= liquidity ? tracked - liquidity : 0;

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
        _checkDonationAttack(pool.token0, pool.reserve0);
        _checkDonationAttack(pool.token1, pool.reserve1);

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
        Pool storage pool = pools[poolId];

        require(
            tokenIn == pool.token0 || tokenIn == pool.token1,
            "Invalid token"
        );

        bool isToken0 = tokenIn == pool.token0;
        address tokenOut = isToken0 ? pool.token1 : pool.token0;

        uint256 reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
        uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;

        // TRADE SIZE LIMIT - prevent large trades that could manipulate price
        uint256 maxTradeSize = poolMaxTradeSize[poolId] > 0
            ? poolMaxTradeSize[poolId]
            : (reserveIn * MAX_TRADE_SIZE_BPS) / 10000;
        if (amountIn > maxTradeSize) {
            emit LargeTradeLimited(poolId, amountIn, maxTradeSize);
            revert TradeTooLarge(maxTradeSize);
        }

        // Calculate output
        amountOut = BatchMath.getAmountOut(
            amountIn,
            reserveIn,
            reserveOut,
            pool.feeRate
        );

        require(amountOut >= minAmountOut, "Insufficient output");

        // Calculate fees
        (uint256 protocolFee, ) = BatchMath.calculateFees(
            amountIn,
            pool.feeRate,
            PROTOCOL_FEE_SHARE
        );

        // Transfer tokens
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(recipient, amountOut);

        // Update reserves
        if (isToken0) {
            pool.reserve0 += amountIn;
            pool.reserve1 -= amountOut;
        } else {
            pool.reserve1 += amountIn;
            pool.reserve0 -= amountOut;
        }

        // Update tracked balances
        trackedBalances[tokenIn] += amountIn;
        if (trackedBalances[tokenOut] >= amountOut) {
            trackedBalances[tokenOut] -= amountOut;
        }

        // Update circuit breakers
        _updateBreaker(VOLUME_BREAKER, amountIn);

        // Track price movement for price breaker
        _checkAndUpdatePriceBreaker(poolId);

        // Track protocol fees
        accumulatedFees[tokenIn] += protocolFee;

        // Update TWAP oracle
        _updateOracle(poolId);

        emit SwapExecuted(poolId, msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    /**
     * @notice Collect accumulated protocol fees
     * @param token Token to collect fees for
     */
    function collectFees(address token) external {
        uint256 amount = accumulatedFees[token];
        require(amount > 0, "No fees to collect");

        accumulatedFees[token] = 0;
        IERC20(token).safeTransfer(treasury, amount);
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
    }

    /**
     * @notice Update treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;
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
            PROTOCOL_FEE_SHARE
        );

        // Reduce output by fee
        uint256 totalFee = (amountOut * pool.feeRate) / 10000;
        amountOut = amountOut - totalFee;

        // Check minimum output after fees
        if (amountOut < order.minAmountOut) {
            // Order not fillable at this price - return tokens to trader
            IERC20(order.tokenIn).safeTransfer(order.trader, amountIn);
            return (0, 0, 0);
        }

        // Verify we have enough output tokens
        uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;
        if (amountOut > reserveOut) {
            // Insufficient liquidity - return tokens to trader
            IERC20(order.tokenIn).safeTransfer(order.trader, amountIn);
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
    function _checkDonationAttack(address token, uint256 expectedBalance) internal view {
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
     */
    function setFlashLoanProtection(bool enabled) external onlyOwner {
        flashLoanProtectionEnabled = enabled;
    }

    /**
     * @notice Enable/disable TWAP validation
     */
    function setTWAPValidation(bool enabled) external onlyOwner {
        twapValidationEnabled = enabled;
    }

    /**
     * @notice Set custom max trade size for a pool
     */
    function setPoolMaxTradeSize(bytes32 poolId, uint256 maxSize) external onlyOwner {
        poolMaxTradeSize[poolId] = maxSize;
    }

    /**
     * @notice Grow oracle cardinality for longer TWAP windows
     */
    function growOracleCardinality(bytes32 poolId, uint16 newCardinality) external onlyOwner {
        poolOracles[poolId].grow(newCardinality);
    }

    /**
     * @notice Sync tracked balance with actual balance (admin recovery)
     */
    function syncTrackedBalance(address token) external onlyOwner {
        trackedBalances[token] = IERC20(token).balanceOf(address(this));
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
}
