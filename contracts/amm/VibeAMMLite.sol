// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./VibeLP.sol";
import "../core/interfaces/IVibeAMM.sol";
import "../libraries/BatchMath.sol";
import "../libraries/TWAPOracle.sol";

/**
 * @title VibeAMMLite
 * @notice Deployment-optimized AMM for Base mainnet (< 24KB)
 * @dev Core AMM: pools, liquidity, swaps, batch execution, TWAP.
 *      Inline circuit breakers (no CircuitBreaker inheritance) for size.
 *      Full VibeAMM (Fibonacci, PoW, VWAP, full CircuitBreaker) via UUPS upgrade.
 */
contract VibeAMMLite is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    IVibeAMM
{
    using SafeERC20 for IERC20;
    using BatchMath for uint256;
    using TWAPOracle for TWAPOracle.OracleState;

    uint256 public constant DEFAULT_FEE_RATE = 5;
    uint256 public constant MINIMUM_LIQUIDITY = 10000;
    uint256 public constant MAX_PRICE_DEVIATION_BPS = 500;
    uint32 public constant DEFAULT_TWAP_PERIOD = 10 minutes;

    // ============ Core State ============

    mapping(bytes32 => Pool) public pools;
    mapping(bytes32 => address) public lpTokens;
    address public treasury;
    mapping(address => bool) public authorizedExecutors;
    mapping(address => uint256) public accumulatedFees;
    mapping(bytes32 => TWAPOracle.OracleState) internal poolOracles;
    mapping(bytes32 => bool) internal sameBlockInteraction;

    // ============ Inline Circuit Breakers ============

    bool public globalPaused;
    struct BreakerState { bool tripped; uint256 trippedAt; uint256 windowStart; uint256 windowValue; }
    struct BreakerConfig { uint256 threshold; uint256 cooldown; uint256 window; }
    bytes32 private constant _VOL = keccak256("VOLUME_BREAKER");
    bytes32 private constant _PRC = keccak256("PRICE_BREAKER");
    bytes32 private constant _WDR = keccak256("WITHDRAWAL_BREAKER");
    mapping(bytes32 => BreakerConfig) internal brkCfg;
    mapping(bytes32 => BreakerState) internal brkState;

    // ============ Protection Flags ============

    uint8 public protectionFlags;
    uint8 private constant FLAG_FLASH_LOAN = 1 << 0;
    uint8 private constant FLAG_TWAP = 1 << 1;

    // ============ Events ============

    event FeesCollected(address indexed token, uint256 amount);
    event BreakerTripped(bytes32 indexed breakerType, uint256 value);

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
    error Paused();
    error SameBlockInteraction();
    error PriceDeviationTooHigh();

    // ============ Modifiers ============

    modifier onlyAuthorizedExecutor() { if (!authorizedExecutors[msg.sender]) revert NotAuthorized(); _; }
    modifier poolExists(bytes32 poolId) { if (!pools[poolId].initialized) revert PoolNotFound(); _; }
    modifier notPaused() { if (globalPaused) revert Paused(); _; }

    modifier brkOk(bytes32 bt) {
        BreakerState storage s = brkState[bt];
        if (s.tripped && block.timestamp < s.trippedAt + brkCfg[bt].cooldown) revert Paused();
        _;
    }

    modifier noFlashLoan(bytes32 poolId) {
        if ((protectionFlags & FLAG_FLASH_LOAN) != 0) {
            bytes32 k = keccak256(abi.encodePacked(msg.sender, poolId, block.number));
            if (sameBlockInteraction[k]) revert SameBlockInteraction();
            sameBlockInteraction[k] = true;
        }
        _;
    }

    modifier validatePrice(bytes32 poolId) {
        _;
        if ((protectionFlags & FLAG_TWAP) != 0 && poolOracles[poolId].cardinality >= 2) {
            Pool storage p = pools[poolId];
            if (p.reserve0 > 0 && poolOracles[poolId].canConsult(DEFAULT_TWAP_PERIOD)) {
                uint256 spot = (p.reserve1 * 1e18) / p.reserve0;
                uint256 twap = poolOracles[poolId].consult(DEFAULT_TWAP_PERIOD);
                if (twap > 0) {
                    uint256 diff = spot > twap ? spot - twap : twap - spot;
                    if (diff * 10000 / twap > MAX_PRICE_DEVIATION_BPS) revert PriceDeviationTooHigh();
                }
            }
        }
    }

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(address _owner, address _treasury) external initializer {
        __Ownable_init(_owner);
        __ReentrancyGuard_init();
        if (_treasury == address(0)) revert InvalidTreasury();
        treasury = _treasury;
        protectionFlags = FLAG_FLASH_LOAN | FLAG_TWAP;
        brkCfg[_VOL] = BreakerConfig(10_000_000 * 1e18, 1 hours, 1 hours);
        brkCfg[_PRC] = BreakerConfig(5000, 30 minutes, 15 minutes);
        brkCfg[_WDR] = BreakerConfig(2500, 2 hours, 1 hours);
    }

    // ============ Pool Management ============

    function createPool(address token0, address token1, uint256 feeRate) external returns (bytes32 poolId) {
        if (token0 == address(0) || token1 == address(0)) revert InvalidToken();
        if (token0 == token1) revert IdenticalTokens();
        (token0, token1) = token0 < token1 ? (token0, token1) : (token1, token0);
        poolId = getPoolId(token0, token1);
        if (pools[poolId].initialized) revert PoolAlreadyExists();
        uint256 fee = feeRate == 0 ? DEFAULT_FEE_RATE : feeRate;
        if (fee > 1000) revert FeeTooHigh();
        pools[poolId] = Pool({ token0: token0, token1: token1, reserve0: 0, reserve1: 0, totalLiquidity: 0, feeRate: fee, initialized: true });
        lpTokens[poolId] = address(new VibeLP(token0, token1, address(this)));
        emit PoolCreated(poolId, token0, token1, fee);
    }

    function addLiquidity(
        bytes32 poolId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min
    ) external nonReentrant poolExists(poolId) noFlashLoan(poolId) notPaused returns (uint256 amount0, uint256 amount1, uint256 liquidity) {
        Pool storage pool = pools[poolId];
        (amount0, amount1) = BatchMath.calculateOptimalLiquidity(amount0Desired, amount1Desired, pool.reserve0, pool.reserve1);
        if (amount0 < amount0Min) revert InsufficientToken0();
        if (amount1 < amount1Min) revert InsufficientToken1();
        IERC20(pool.token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(pool.token1).safeTransferFrom(msg.sender, address(this), amount1);
        liquidity = BatchMath.calculateLiquidity(amount0, amount1, pool.reserve0, pool.reserve1, pool.totalLiquidity);
        if (pool.totalLiquidity == 0) {
            if (liquidity <= MINIMUM_LIQUIDITY) revert InitialLiquidityTooLow();
            unchecked { liquidity -= MINIMUM_LIQUIDITY; }
            VibeLP(lpTokens[poolId]).mint(address(0xdead), MINIMUM_LIQUIDITY);
            pool.totalLiquidity += MINIMUM_LIQUIDITY;
            poolOracles[poolId].initialize(amount0 > 0 ? (amount1 * 1e18) / amount0 : 0);
        }
        if (liquidity == 0) revert InsufficientLiquidityMinted();
        unchecked { pool.reserve0 += amount0; pool.reserve1 += amount1; pool.totalLiquidity += liquidity; }
        _updateOracle(poolId);
        VibeLP(lpTokens[poolId]).mint(msg.sender, liquidity);
        emit LiquidityAdded(poolId, msg.sender, amount0, amount1, liquidity);
    }

    function removeLiquidity(
        bytes32 poolId, uint256 liquidity, uint256 amount0Min, uint256 amount1Min
    ) external nonReentrant poolExists(poolId) noFlashLoan(poolId) notPaused brkOk(_WDR) returns (uint256 amount0, uint256 amount1) {
        Pool storage pool = pools[poolId];
        address lp = lpTokens[poolId];
        if (liquidity == 0 || pool.totalLiquidity < liquidity) revert InvalidLiquidity();
        if (IERC20(lp).balanceOf(msg.sender) < liquidity) revert InsufficientLiquidityBalance();
        amount0 = (liquidity * pool.reserve0) / pool.totalLiquidity;
        amount1 = (liquidity * pool.reserve1) / pool.totalLiquidity;
        if (amount0 < amount0Min) revert InsufficientToken0();
        if (amount1 < amount1Min) revert InsufficientToken1();
        _updBrk(_WDR, pool.totalLiquidity > 0 ? (liquidity * 10000) / pool.totalLiquidity : 0);
        unchecked { pool.reserve0 -= amount0; pool.reserve1 -= amount1; pool.totalLiquidity -= liquidity; }
        VibeLP(lp).burn(msg.sender, liquidity);
        IERC20(pool.token0).safeTransfer(msg.sender, amount0);
        IERC20(pool.token1).safeTransfer(msg.sender, amount1);
        _updateOracle(poolId);
        emit LiquidityRemoved(poolId, msg.sender, amount0, amount1, liquidity);
    }

    // ============ Swap Functions ============

    function executeBatchSwap(
        bytes32 poolId, uint64 batchId, SwapOrder[] calldata orders
    ) external nonReentrant onlyAuthorizedExecutor poolExists(poolId) notPaused brkOk(_VOL) returns (BatchSwapResult memory result) {
        if (orders.length == 0) return BatchSwapResult(0, 0, 0, 0);
        Pool storage pool = pools[poolId];
        (uint256[] memory buys, uint256[] memory sells) = _catOrders(orders, pool.token0, pool.reserve0, pool.reserve1);
        (uint256 cp, ) = BatchMath.calculateClearingPrice(buys, sells, pool.reserve0, pool.reserve1);
        result.clearingPrice = cp;
        for (uint256 i = 0; i < orders.length; i++) {
            (uint256 ai, uint256 ao, uint256 f) = _batchSwap(pool, orders[i], cp);
            result.totalTokenInSwapped += ai; result.totalTokenOutSwapped += ao; result.protocolFees += f;
        }
        _updBrk(_VOL, result.totalTokenInSwapped);
        _updateOracle(poolId);
        emit BatchSwapExecuted(poolId, batchId, cp, orders.length, result.protocolFees);
    }

    function swap(
        bytes32 poolId, address tokenIn, uint256 amountIn, uint256 minAmountOut, address recipient
    ) external nonReentrant poolExists(poolId) noFlashLoan(poolId) notPaused
      brkOk(_VOL) brkOk(_PRC) validatePrice(poolId) returns (uint256 amountOut) {
        Pool storage pool = pools[poolId];
        if (tokenIn != pool.token0 && tokenIn != pool.token1) revert InvalidToken();
        bool isT0 = tokenIn == pool.token0;
        amountOut = BatchMath.getAmountOut(amountIn, isT0 ? pool.reserve0 : pool.reserve1, isT0 ? pool.reserve1 : pool.reserve0, pool.feeRate);
        if (amountOut < minAmountOut) revert InsufficientOutput();
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(isT0 ? pool.token1 : pool.token0).safeTransfer(recipient, amountOut);
        unchecked {
            if (isT0) { pool.reserve0 += amountIn; pool.reserve1 -= amountOut; }
            else { pool.reserve1 += amountIn; pool.reserve0 -= amountOut; }
        }
        _updBrk(_VOL, amountIn);
        _updateOracle(poolId);
        emit SwapExecuted(poolId, msg.sender, tokenIn, isT0 ? pool.token1 : pool.token0, amountIn, amountOut);
    }

    // ============ Internals ============

    function _catOrders(SwapOrder[] calldata orders, address token0, uint256 r0, uint256 r1) internal pure returns (uint256[] memory buys, uint256[] memory sells) {
        uint256 bc; uint256 sc;
        for (uint256 i = 0; i < orders.length; i++) { if (orders[i].tokenIn == token0) sc++; else bc++; }
        buys = new uint256[](bc * 2); sells = new uint256[](sc * 2);
        uint256 bi; uint256 si; uint256 sp = r0 > 0 ? (r1 * 1e18) / r0 : 0;
        for (uint256 i = 0; i < orders.length; i++) {
            if (orders[i].tokenIn == token0) {
                sells[si] = orders[i].amountIn; sells[si + 1] = orders[i].amountIn > 0 ? (orders[i].minAmountOut * 1e18) / orders[i].amountIn : 0; si += 2;
            } else {
                buys[bi] = orders[i].amountIn; buys[bi + 1] = orders[i].minAmountOut > 0 ? (orders[i].amountIn * 1e18) / orders[i].minAmountOut : sp * 2; bi += 2;
            }
        }
    }

    function _batchSwap(Pool storage pool, SwapOrder calldata order, uint256 cp) internal returns (uint256 ai, uint256 ao, uint256 pf) {
        bool isT0 = order.tokenIn == pool.token0;
        ai = order.amountIn;
        ao = isT0 ? (ai * cp) / 1e18 : (cp > 0 ? (ai * 1e18) / cp : 0);
        uint256 tf = (ao * pool.feeRate) / 10000;
        (pf, ) = BatchMath.calculateFees(ao, pool.feeRate, 0);
        ao -= tf;
        uint256 rOut = isT0 ? pool.reserve1 : pool.reserve0;
        uint256 reserveDeduction = ao + tf - pf;
        if (ao < order.minAmountOut || reserveDeduction > rOut) {
            IERC20(order.tokenIn).safeTransfer(msg.sender, ai);
            return (0, 0, 0);
        }
        address tokenOut = isT0 ? pool.token1 : pool.token0;
        IERC20(tokenOut).safeTransfer(order.trader, ao);
        if (isT0) { pool.reserve0 += ai; pool.reserve1 -= (ao + tf - pf); }
        else { pool.reserve1 += ai; pool.reserve0 -= (ao + tf - pf); }
        accumulatedFees[tokenOut] += pf;
        emit SwapExecuted(getPoolId(pool.token0, pool.token1), order.trader, order.tokenIn, tokenOut, ai, ao);
    }

    function _updateOracle(bytes32 poolId) internal {
        Pool storage p = pools[poolId];
        if (p.reserve0 > 0) poolOracles[poolId].write((p.reserve1 * 1e18) / p.reserve0);
    }

    function _updBrk(bytes32 bt, uint256 val) internal {
        BreakerConfig storage c = brkCfg[bt];
        BreakerState storage s = brkState[bt];
        if (c.threshold == 0 || s.tripped) return;
        if (block.timestamp >= s.windowStart + c.window) { s.windowStart = block.timestamp; s.windowValue = 0; }
        s.windowValue += val;
        if (s.windowValue >= c.threshold) { s.tripped = true; s.trippedAt = block.timestamp; emit BreakerTripped(bt, s.windowValue); }
    }

    // ============ Views ============

    function getPool(bytes32 poolId) external view returns (Pool memory) { return pools[poolId]; }
    function getPoolId(address a, address b) public pure returns (bytes32) { (address t0, address t1) = a < b ? (a, b) : (b, a); return keccak256(abi.encodePacked(t0, t1)); }
    function getLPToken(bytes32 poolId) external view returns (address) { return lpTokens[poolId]; }
    function getSpotPrice(bytes32 poolId) external view poolExists(poolId) returns (uint256) { Pool storage p = pools[poolId]; return p.reserve0 == 0 ? 0 : (p.reserve1 * 1e18) / p.reserve0; }
    function getTWAP(bytes32 poolId, uint32 period) external view returns (uint256) { return poolOracles[poolId].canConsult(period) ? poolOracles[poolId].consult(period) : 0; }

    function quote(bytes32 poolId, address tokenIn, uint256 amountIn) external view poolExists(poolId) returns (uint256) {
        Pool storage p = pools[poolId];
        bool isT0 = tokenIn == p.token0;
        return BatchMath.getAmountOut(amountIn, isT0 ? p.reserve0 : p.reserve1, isT0 ? p.reserve1 : p.reserve0, p.feeRate);
    }

    // ============ Admin ============

    function setAuthorizedExecutor(address e, bool a) external onlyOwner { authorizedExecutors[e] = a; }
    function setTreasury(address t) external onlyOwner { if (t == address(0)) revert InvalidTreasury(); treasury = t; }
    function setGlobalPause(bool p) external onlyOwner { globalPaused = p; }
    function setFlashLoanProtection(bool e) external onlyOwner { if (e) protectionFlags |= FLAG_FLASH_LOAN; else protectionFlags &= ~FLAG_FLASH_LOAN; }
    function setTWAPValidation(bool e) external onlyOwner { if (e) protectionFlags |= FLAG_TWAP; else protectionFlags &= ~FLAG_TWAP; }

    function collectFees(address token) external nonReentrant {
        if (msg.sender != treasury && msg.sender != owner()) revert NotAuthorized();
        uint256 a = accumulatedFees[token];
        if (a == 0) revert InsufficientOutput();
        accumulatedFees[token] = 0;
        IERC20(token).safeTransfer(treasury, a);
        emit FeesCollected(token, a);
    }

    function growOracleCardinality(bytes32 poolId, uint16 newCardinality) external onlyOwner {
        poolOracles[poolId].grow(newCardinality);
    }
}
