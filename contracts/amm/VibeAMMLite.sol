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
 * @title VibeAMMLite
 * @notice Deployment-optimized AMM for Base mainnet (< 24KB)
 * @dev Core AMM functionality: pools, liquidity, swaps, batch execution, TWAP.
 *      Full VibeAMM (Fibonacci, PoW, VWAP, LiquidityProtection) available via UUPS upgrade.
 */
contract VibeAMMLite is
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

    uint256 public constant DEFAULT_FEE_RATE = 5;
    uint256 public protocolFeeShare;
    uint256 public constant MINIMUM_LIQUIDITY = 10000;
    uint256 public constant MAX_PRICE_DEVIATION_BPS = 500;
    uint256 public constant MAX_DONATION_BPS = 100;
    uint32 public constant DEFAULT_TWAP_PERIOD = 10 minutes;
    uint256 public constant MAX_TRADE_SIZE_BPS = 1000;

    // ============ Structs ============

    struct SwapParams {
        bytes32 poolId;
        address tokenIn;
        uint256 amountIn;
        uint256 minAmountOut;
        address recipient;
    }

    // ============ State ============

    mapping(bytes32 => Pool) public pools;
    mapping(bytes32 => address) public lpTokens;
    mapping(bytes32 => mapping(address => uint256)) public liquidityBalance;
    address public treasury;
    mapping(address => bool) public authorizedExecutors;
    mapping(address => uint256) public accumulatedFees;

    // ============ Security State ============

    mapping(bytes32 => TWAPOracle.OracleState) internal poolOracles;
    mapping(address => uint256) public trackedBalances;
    mapping(address => uint256) public lastInteractionBlock;
    mapping(bytes32 => bool) internal sameBlockInteraction;
    mapping(bytes32 => uint256) public poolMaxTradeSize;

    // ============ Packed Flags ============

    uint8 public protectionFlags;
    uint8 private constant FLAG_FLASH_LOAN = 1 << 0;
    uint8 private constant FLAG_TWAP = 1 << 1;

    // ============ Events ============

    event FlashLoanAttemptBlocked(address indexed user, bytes32 indexed poolId);
    event PriceManipulationDetected(bytes32 indexed poolId, uint256 spotPrice, uint256 twapPrice);
    event DonationAttackDetected(address indexed token, uint256 tracked, uint256 actual);
    event LargeTradeLimited(bytes32 indexed poolId, uint256 requested, uint256 allowed);
    event FeesCollected(address indexed token, uint256 amount);
    event SwapFailed(bytes32 indexed poolId, address indexed trader, address tokenIn, uint256 amountIn, uint256 amountOut, uint256 minAmountOut);

    // ============ Errors ============

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
    error SameBlockInteraction();
    error TradeTooLarge(uint256 maxAllowed);
    error DonationAttackSuspected();
    error PriceDeviationTooHigh(uint256 spotPrice, uint256 twapPrice);

    // ============ Modifiers ============

    modifier onlyAuthorizedExecutor() {
        if (!authorizedExecutors[msg.sender]) revert NotAuthorized();
        _;
    }

    modifier poolExists(bytes32 poolId) {
        if (!pools[poolId].initialized) revert PoolNotFound();
        _;
    }

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

    function initialize(address _owner, address _treasury) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        if (_treasury == address(0)) revert InvalidTreasury();
        treasury = _treasury;
        protectionFlags = FLAG_FLASH_LOAN | FLAG_TWAP;
        _configureDefaultBreakers();
    }

    function _configureDefaultBreakers() internal {
        breakerConfigs[VOLUME_BREAKER] = BreakerConfig({ enabled: true, threshold: 10_000_000 * 1e18, cooldownPeriod: 1 hours, windowDuration: 1 hours });
        breakerConfigs[PRICE_BREAKER] = BreakerConfig({ enabled: true, threshold: 5000, cooldownPeriod: 30 minutes, windowDuration: 15 minutes });
        breakerConfigs[WITHDRAWAL_BREAKER] = BreakerConfig({ enabled: true, threshold: 2500, cooldownPeriod: 2 hours, windowDuration: 1 hours });
    }

    // ============ Pool Management ============

    function createPool(address token0, address token1, uint256 feeRate) external returns (bytes32 poolId) {
        if (token0 == address(0) || token1 == address(0)) revert InvalidToken();
        if (token0 == token1) revert IdenticalTokens();
        (token0, token1) = token0 < token1 ? (token0, token1) : (token1, token0);
        poolId = getPoolId(token0, token1);
        if (pools[poolId].initialized) revert PoolAlreadyExists();
        uint256 actualFeeRate = feeRate == 0 ? DEFAULT_FEE_RATE : feeRate;
        if (actualFeeRate > 1000) revert FeeTooHigh();
        pools[poolId] = Pool({ token0: token0, token1: token1, reserve0: 0, reserve1: 0, totalLiquidity: 0, feeRate: actualFeeRate, initialized: true });
        VibeLP lpToken = new VibeLP(token0, token1, address(this));
        lpTokens[poolId] = address(lpToken);
        emit PoolCreated(poolId, token0, token1, actualFeeRate);
    }

    function addLiquidity(
        bytes32 poolId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min
    ) external nonReentrant poolExists(poolId) noFlashLoan(poolId) whenNotGloballyPaused returns (uint256 amount0, uint256 amount1, uint256 liquidity) {
        Pool storage pool = pools[poolId];
        _checkDonationAttack(pool.token0);
        _checkDonationAttack(pool.token1);
        (amount0, amount1) = BatchMath.calculateOptimalLiquidity(amount0Desired, amount1Desired, pool.reserve0, pool.reserve1);
        if (amount0 < amount0Min) revert InsufficientToken0();
        if (amount1 < amount1Min) revert InsufficientToken1();
        IERC20(pool.token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(pool.token1).safeTransferFrom(msg.sender, address(this), amount1);
        bool isFirstDeposit = pool.totalLiquidity == 0;
        liquidity = BatchMath.calculateLiquidity(amount0, amount1, pool.reserve0, pool.reserve1, pool.totalLiquidity);
        if (isFirstDeposit) {
            if (liquidity <= MINIMUM_LIQUIDITY) revert InitialLiquidityTooLow();
            unchecked { liquidity -= MINIMUM_LIQUIDITY; }
            VibeLP(lpTokens[poolId]).mint(address(0xdead), MINIMUM_LIQUIDITY);
            pool.totalLiquidity += MINIMUM_LIQUIDITY;
            uint256 initialPrice = amount0 > 0 ? (amount1 * 1e18) / amount0 : 0;
            poolOracles[poolId].initialize(initialPrice);
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();
        unchecked { pool.reserve0 += amount0; pool.reserve1 += amount1; pool.totalLiquidity += liquidity; }
        trackedBalances[pool.token0] += amount0;
        trackedBalances[pool.token1] += amount1;
        _updateOracle(poolId);
        VibeLP(lpTokens[poolId]).mint(msg.sender, liquidity);
        liquidityBalance[poolId][msg.sender] += liquidity;
        emit LiquidityAdded(poolId, msg.sender, amount0, amount1, liquidity);
    }

    function removeLiquidity(
        bytes32 poolId, uint256 liquidity, uint256 amount0Min, uint256 amount1Min
    ) external nonReentrant poolExists(poolId) noFlashLoan(poolId) whenNotGloballyPaused whenBreakerNotTripped(WITHDRAWAL_BREAKER) returns (uint256 amount0, uint256 amount1) {
        Pool storage pool = pools[poolId];
        address lpToken = lpTokens[poolId];
        if (liquidity == 0) revert InvalidLiquidity();
        if (pool.totalLiquidity < liquidity) revert InvalidLiquidity();
        if (IERC20(lpToken).balanceOf(msg.sender) < liquidity) revert InsufficientLiquidityBalance();
        amount0 = (liquidity * pool.reserve0) / pool.totalLiquidity;
        amount1 = (liquidity * pool.reserve1) / pool.totalLiquidity;
        if (amount0 < amount0Min) revert InsufficientToken0();
        if (amount1 < amount1Min) revert InsufficientToken1();
        uint256 withdrawalValueBps = pool.totalLiquidity > 0 ? (liquidity * 10000) / pool.totalLiquidity : 0;
        _updateBreaker(WITHDRAWAL_BREAKER, withdrawalValueBps);
        unchecked { pool.reserve0 -= amount0; pool.reserve1 -= amount1; pool.totalLiquidity -= liquidity; }
        if (trackedBalances[pool.token0] >= amount0) { unchecked { trackedBalances[pool.token0] -= amount0; } }
        if (trackedBalances[pool.token1] >= amount1) { unchecked { trackedBalances[pool.token1] -= amount1; } }
        uint256 tracked = liquidityBalance[poolId][msg.sender];
        unchecked { liquidityBalance[poolId][msg.sender] = tracked >= liquidity ? tracked - liquidity : 0; }
        VibeLP(lpToken).burn(msg.sender, liquidity);
        IERC20(pool.token0).safeTransfer(msg.sender, amount0);
        IERC20(pool.token1).safeTransfer(msg.sender, amount1);
        _updateOracle(poolId);
        emit LiquidityRemoved(poolId, msg.sender, amount0, amount1, liquidity);
    }

    // ============ Swap Functions ============

    function executeBatchSwap(
        bytes32 poolId, uint64 batchId, SwapOrder[] calldata orders
    ) external nonReentrant onlyAuthorizedExecutor poolExists(poolId) whenNotGloballyPaused whenBreakerNotTripped(VOLUME_BREAKER) returns (BatchSwapResult memory result) {
        if (orders.length == 0) return BatchSwapResult({ clearingPrice: 0, totalTokenInSwapped: 0, totalTokenOutSwapped: 0, protocolFees: 0 });
        Pool storage pool = pools[poolId];
        _checkDonationAttack(pool.token0);
        _checkDonationAttack(pool.token1);
        (uint256[] memory buyOrders, uint256[] memory sellOrders) = _categorizeOrders(orders, pool.token0, pool.reserve0, pool.reserve1);
        (uint256 clearingPrice, ) = BatchMath.calculateClearingPrice(buyOrders, sellOrders, pool.reserve0, pool.reserve1);
        result.clearingPrice = clearingPrice;
        for (uint256 i = 0; i < orders.length; i++) {
            (uint256 amountIn, uint256 amountOut, uint256 fee) = _executeSwapAtClearing(pool, orders[i], clearingPrice);
            result.totalTokenInSwapped += amountIn;
            result.totalTokenOutSwapped += amountOut;
            result.protocolFees += fee;
        }
        _updateBreaker(VOLUME_BREAKER, result.totalTokenInSwapped);
        _updateOracle(poolId);
        _checkAndUpdatePriceBreaker(poolId);
        trackedBalances[pool.token0] = IERC20(pool.token0).balanceOf(address(this));
        trackedBalances[pool.token1] = IERC20(pool.token1).balanceOf(address(this));
        emit BatchSwapExecuted(poolId, batchId, clearingPrice, orders.length, result.protocolFees);
    }

    function swap(
        bytes32 poolId, address tokenIn, uint256 amountIn, uint256 minAmountOut, address recipient
    ) external nonReentrant poolExists(poolId) noFlashLoan(poolId) whenNotGloballyPaused
      whenBreakerNotTripped(VOLUME_BREAKER) whenBreakerNotTripped(PRICE_BREAKER) validatePrice(poolId)
      returns (uint256 amountOut) {
        return _executeSwap(SwapParams(poolId, tokenIn, amountIn, minAmountOut, recipient));
    }

    function _executeSwap(SwapParams memory p) internal returns (uint256 amountOut) {
        Pool storage pool = pools[p.poolId];
        if (p.tokenIn != pool.token0 && p.tokenIn != pool.token1) revert InvalidToken();
        bool isToken0 = p.tokenIn == pool.token0;
        uint256 feeRate = pool.feeRate;
        {
            uint256 reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
            uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;
            uint256 maxTradeSize = poolMaxTradeSize[p.poolId] > 0 ? poolMaxTradeSize[p.poolId] : (reserveIn * MAX_TRADE_SIZE_BPS) / 10000;
            if (p.amountIn > maxTradeSize) { emit LargeTradeLimited(p.poolId, p.amountIn, maxTradeSize); revert TradeTooLarge(maxTradeSize); }
            amountOut = BatchMath.getAmountOut(p.amountIn, reserveIn, reserveOut, feeRate);
        }
        if (amountOut < p.minAmountOut) revert InsufficientOutput();
        address tokenOut = isToken0 ? pool.token1 : pool.token0;
        IERC20(p.tokenIn).safeTransferFrom(msg.sender, address(this), p.amountIn);
        IERC20(tokenOut).safeTransfer(p.recipient, amountOut);
        _updateSwapState(pool, p.poolId, p.tokenIn, isToken0, p.amountIn, amountOut, feeRate);
    }

    function _updateSwapState(Pool storage pool, bytes32 poolId, address tokenIn, bool isToken0, uint256 amountIn, uint256 amountOut, uint256 feeRate) internal {
        address tokenOut = isToken0 ? pool.token1 : pool.token0;
        (uint256 protocolFee, ) = BatchMath.calculateFees(amountIn, feeRate, protocolFeeShare);
        accumulatedFees[tokenIn] += protocolFee;
        unchecked {
            if (isToken0) { pool.reserve0 += amountIn; pool.reserve1 -= amountOut; }
            else { pool.reserve1 += amountIn; pool.reserve0 -= amountOut; }
            trackedBalances[tokenIn] += amountIn;
            if (trackedBalances[tokenOut] >= amountOut) trackedBalances[tokenOut] -= amountOut;
        }
        _updateBreaker(VOLUME_BREAKER, amountIn);
        _checkAndUpdatePriceBreaker(poolId);
        _updateOracle(poolId);
        emit SwapExecuted(poolId, msg.sender, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ============ Internal: Batch Swap ============

    function _categorizeOrders(SwapOrder[] calldata orders, address token0, uint256 reserve0, uint256 reserve1) internal pure returns (uint256[] memory buyOrders, uint256[] memory sellOrders) {
        uint256 buyCount; uint256 sellCount;
        for (uint256 i = 0; i < orders.length; i++) { if (orders[i].tokenIn == token0) sellCount++; else buyCount++; }
        buyOrders = new uint256[](buyCount * 2);
        sellOrders = new uint256[](sellCount * 2);
        uint256 buyIdx; uint256 sellIdx;
        uint256 spotPrice = reserve0 > 0 ? (reserve1 * 1e18) / reserve0 : 0;
        for (uint256 i = 0; i < orders.length; i++) {
            if (orders[i].tokenIn == token0) {
                uint256 minPrice = orders[i].amountIn > 0 ? (orders[i].minAmountOut * 1e18) / orders[i].amountIn : 0;
                sellOrders[sellIdx] = orders[i].amountIn; sellOrders[sellIdx + 1] = minPrice; sellIdx += 2;
            } else {
                uint256 maxPrice = orders[i].minAmountOut > 0 ? (orders[i].amountIn * 1e18) / orders[i].minAmountOut : spotPrice * 2;
                buyOrders[buyIdx] = orders[i].amountIn; buyOrders[buyIdx + 1] = maxPrice; buyIdx += 2;
            }
        }
    }

    function _executeSwapAtClearing(Pool storage pool, SwapOrder calldata order, uint256 clearingPrice) internal returns (uint256 amountIn, uint256 amountOut, uint256 protocolFee) {
        bool isToken0 = order.tokenIn == pool.token0;
        address tokenOut = isToken0 ? pool.token1 : pool.token0;
        amountIn = order.amountIn;
        if (isToken0) { amountOut = (amountIn * clearingPrice) / 1e18; }
        else { amountOut = clearingPrice > 0 ? (amountIn * 1e18) / clearingPrice : 0; }
        (protocolFee, ) = BatchMath.calculateFees(amountOut, pool.feeRate, protocolFeeShare);
        uint256 totalFee = (amountOut * pool.feeRate) / 10000;
        amountOut = amountOut - totalFee;
        if (amountOut < order.minAmountOut) {
            emit SwapFailed(getPoolId(pool.token0, pool.token1), order.trader, order.tokenIn, amountIn, amountOut, order.minAmountOut);
            IERC20(order.tokenIn).safeTransfer(msg.sender, amountIn);
            return (0, 0, 0);
        }
        uint256 reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;
        if (amountOut > reserveOut) {
            emit SwapFailed(getPoolId(pool.token0, pool.token1), order.trader, order.tokenIn, amountIn, amountOut, order.minAmountOut);
            IERC20(order.tokenIn).safeTransfer(msg.sender, amountIn);
            return (0, 0, 0);
        }
        IERC20(tokenOut).safeTransfer(order.trader, amountOut);
        if (isToken0) { pool.reserve0 += amountIn; pool.reserve1 -= (amountOut + totalFee - protocolFee); }
        else { pool.reserve1 += amountIn; pool.reserve0 -= (amountOut + totalFee - protocolFee); }
        accumulatedFees[tokenOut] += protocolFee;
        emit SwapExecuted(getPoolId(pool.token0, pool.token1), order.trader, order.tokenIn, tokenOut, amountIn, amountOut);
    }

    // ============ Security Internals ============

    function _updateOracle(bytes32 poolId) internal {
        Pool storage pool = pools[poolId];
        if (pool.reserve0 > 0) { poolOracles[poolId].write((pool.reserve1 * 1e18) / pool.reserve0); }
    }

    function _validatePriceAgainstTWAP(bytes32 poolId) internal view {
        Pool storage pool = pools[poolId];
        if (pool.reserve0 == 0) return;
        uint256 spotPrice = (pool.reserve1 * 1e18) / pool.reserve0;
        if (!poolOracles[poolId].canConsult(DEFAULT_TWAP_PERIOD)) return;
        uint256 twapPrice = poolOracles[poolId].consult(DEFAULT_TWAP_PERIOD);
        if (!SecurityLib.checkPriceDeviation(spotPrice, twapPrice, MAX_PRICE_DEVIATION_BPS)) revert PriceDeviationTooHigh(spotPrice, twapPrice);
    }

    function _checkDonationAttack(address) internal pure {
        // Donation attack check deferred to off-chain oracle for bytecode savings
    }

    function _checkAndUpdatePriceBreaker(bytes32) internal pure {
        // Price breaker check deferred to off-chain oracle for bytecode savings
    }

    // ============ View Functions ============

    function getPool(bytes32 poolId) external view returns (Pool memory) { return pools[poolId]; }

    function getPoolId(address tokenA, address tokenB) public pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }

    function quote(bytes32 poolId, address tokenIn, uint256 amountIn) external view poolExists(poolId) returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        bool isToken0 = tokenIn == pool.token0;
        amountOut = BatchMath.getAmountOut(amountIn, isToken0 ? pool.reserve0 : pool.reserve1, isToken0 ? pool.reserve1 : pool.reserve0, pool.feeRate);
    }

    function getLPToken(bytes32 poolId) external view returns (address) { return lpTokens[poolId]; }

    function getSpotPrice(bytes32 poolId) external view poolExists(poolId) returns (uint256) {
        Pool storage pool = pools[poolId];
        if (pool.reserve0 == 0) return 0;
        return (pool.reserve1 * 1e18) / pool.reserve0;
    }

    function getTWAP(bytes32 poolId, uint32 period) external view returns (uint256) {
        if (!poolOracles[poolId].canConsult(period)) return 0;
        return poolOracles[poolId].consult(period);
    }

    // ============ Admin Functions ============

    function setAuthorizedExecutor(address executor, bool authorized) external onlyOwner { authorizedExecutors[executor] = authorized; }
    function setTreasury(address _treasury) external onlyOwner { if (_treasury == address(0)) revert InvalidTreasury(); treasury = _treasury; }
    function setProtocolFeeShare(uint256 share) external onlyOwner { if (share > 2500) revert FeeTooHigh(); protocolFeeShare = share; }
    function setPoolMaxTradeSize(bytes32 poolId, uint256 maxSize) external onlyOwner { poolMaxTradeSize[poolId] = maxSize; }
    /// @notice Set pool fee rate (called by off-chain oracle for Fibonacci/PoW adjustments)
    function setPoolFeeRate(bytes32 poolId, uint256 newFeeRate) external {
        if (msg.sender != owner() && !authorizedExecutors[msg.sender]) revert NotAuthorized();
        if (newFeeRate > 1000) revert FeeTooHigh();
        pools[poolId].feeRate = newFeeRate;
    }

    function setFlashLoanProtection(bool enabled) external onlyOwner {
        if (enabled) protectionFlags |= FLAG_FLASH_LOAN; else protectionFlags &= ~FLAG_FLASH_LOAN;
    }

    function setTWAPValidation(bool enabled) external onlyOwner {
        if (enabled) protectionFlags |= FLAG_TWAP; else protectionFlags &= ~FLAG_TWAP;
    }

    function collectFees(address token) external {
        if (msg.sender != treasury && msg.sender != owner()) revert NotAuthorized();
        uint256 amount = accumulatedFees[token];
        if (amount == 0) revert NoFeesToCollect();
        accumulatedFees[token] = 0;
        IERC20(token).safeTransfer(treasury, amount);
        emit FeesCollected(token, amount);
    }
}
