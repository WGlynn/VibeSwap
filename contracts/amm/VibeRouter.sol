// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title VibeRouter
 * @author Faraday1 & JARVIS -- vibeswap.org
 * @notice Multi-path trade aggregation router (Jupiter pattern) for optimal routing across pools
 * @dev Splits trades across multiple routes/pool types to minimize slippage.
 *      Supports ConstantProduct, StableSwap, and BatchAuction pool types.
 */
contract VibeRouter is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Constants ============

    /// @notice Basis points denominator (100%)
    uint256 public constant BPS_DENOMINATOR = 10000;

    /// @notice Maximum number of routes per swap
    uint256 public constant MAX_ROUTES = 5;

    /// @notice Maximum hops per route
    uint256 public constant MAX_HOPS = 4;

    // ============ Enums ============

    /// @notice Pool type identifiers
    /// @dev 0 = ConstantProduct, 1 = StableSwap, 2 = BatchAuction
    uint256 public constant POOL_TYPE_CONSTANT_PRODUCT = 0;
    uint256 public constant POOL_TYPE_STABLE_SWAP = 1;
    uint256 public constant POOL_TYPE_BATCH_AUCTION = 2;

    // ============ Structs ============

    struct Route {
        address[] path;      // token addresses in path
        address[] pools;     // pool addresses for each hop
        uint256[] poolTypes; // 0 = ConstantProduct, 1 = StableSwap, 2 = BatchAuction
    }

    struct SwapParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        Route[] routes;      // split across multiple routes
        uint256[] splitBps;  // percentage to each route (must sum to 10000)
        uint256 deadline;
    }

    // ============ Storage ============

    /// @notice Registered pools: pool address => pool type
    mapping(address => uint256) public poolTypes;

    /// @notice Whether a pool is registered
    mapping(address => bool) public isRegisteredPool;

    /// @notice All registered pool addresses
    address[] public registeredPools;

    /// @notice Index of pool in registeredPools array (1-indexed, 0 = not found)
    mapping(address => uint256) private _poolIndex;

    /// @notice Mapping of token pair => list of pools that serve this pair
    /// @dev key = keccak256(abi.encodePacked(tokenA, tokenB)) where tokenA < tokenB
    mapping(bytes32 => address[]) public pairPools;

    // ============ Events ============

    event PoolRegistered(address indexed pool, uint256 poolType);
    event PoolRemoved(address indexed pool);
    event SwapExecuted(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 routeCount
    );

    // ============ Custom Errors ============

    error DeadlineExpired();
    error InsufficientOutput(uint256 amountOut, uint256 minAmountOut);
    error InvalidRoutes();
    error InvalidSplitBps();
    error PoolAlreadyRegistered(address pool);
    error PoolNotRegistered(address pool);
    error InvalidPoolType(uint256 poolType);
    error TooManyRoutes();
    error TooManyHops();
    error ZeroAddress();
    error ZeroAmount();
    error PathMismatch();
    error SwapFailed(address pool);

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the router
     * @param owner_ Protocol owner
     */
    function initialize(address owner_) external initializer {
        if (owner_ == address(0)) revert ZeroAddress();

        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
    }

    // ============ External Functions ============

    /**
     * @notice Execute a multi-route swap
     * @param params Swap parameters including routes and split percentages
     * @return amountOut Total output amount received
     */
    function swap(SwapParams calldata params) external nonReentrant returns (uint256 amountOut) {
        // Validate deadline
        if (block.timestamp > params.deadline) revert DeadlineExpired();
        if (params.amountIn == 0) revert ZeroAmount();
        if (params.tokenIn == address(0) || params.tokenOut == address(0)) revert ZeroAddress();

        // Validate routes
        uint256 routeCount = params.routes.length;
        if (routeCount == 0) revert InvalidRoutes();
        if (routeCount > MAX_ROUTES) revert TooManyRoutes();
        if (routeCount != params.splitBps.length) revert InvalidSplitBps();

        // Validate split percentages sum to 10000
        uint256 totalBps;
        for (uint256 i; i < routeCount; ++i) {
            totalBps += params.splitBps[i];
        }
        if (totalBps != BPS_DENOMINATOR) revert InvalidSplitBps();

        // Transfer tokenIn from sender
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);

        // Execute each route
        for (uint256 i; i < routeCount; ++i) {
            Route calldata route = params.routes[i];

            // Validate route structure
            if (route.path.length < 2) revert InvalidRoutes();
            if (route.path.length - 1 != route.pools.length) revert PathMismatch();
            if (route.pools.length != route.poolTypes.length) revert PathMismatch();
            if (route.pools.length > MAX_HOPS) revert TooManyHops();

            // Validate path endpoints match swap tokens
            if (route.path[0] != params.tokenIn) revert PathMismatch();
            if (route.path[route.path.length - 1] != params.tokenOut) revert PathMismatch();

            // Calculate amount for this route
            uint256 routeAmountIn = (params.amountIn * params.splitBps[i]) / BPS_DENOMINATOR;
            if (routeAmountIn == 0) continue;

            // Execute hops along this route
            uint256 currentAmount = routeAmountIn;
            for (uint256 j; j < route.pools.length; ++j) {
                if (!isRegisteredPool[route.pools[j]]) revert PoolNotRegistered(route.pools[j]);

                address hopTokenIn = route.path[j];
                address hopTokenOut = route.path[j + 1];

                // Approve pool to spend tokens
                IERC20(hopTokenIn).forceApprove(route.pools[j], currentAmount);

                // Get balance before swap to compute actual output
                uint256 balBefore = IERC20(hopTokenOut).balanceOf(address(this));

                // Execute swap via pool
                // Pools must implement: swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
                (bool success,) = route.pools[j].call(
                    abi.encodeWithSignature(
                        "swap(address,address,uint256,uint256,address)",
                        hopTokenIn,
                        hopTokenOut,
                        currentAmount,
                        0, // minOut checked at end
                        address(this)
                    )
                );
                if (!success) revert SwapFailed(route.pools[j]);

                currentAmount = IERC20(hopTokenOut).balanceOf(address(this)) - balBefore;
            }

            amountOut += currentAmount;
        }

        // Validate minimum output
        if (amountOut < params.minAmountOut) revert InsufficientOutput(amountOut, params.minAmountOut);

        // Transfer output to sender
        IERC20(params.tokenOut).safeTransfer(msg.sender, amountOut);

        emit SwapExecuted(
            msg.sender,
            params.tokenIn,
            params.tokenOut,
            params.amountIn,
            amountOut,
            routeCount
        );
    }

    /**
     * @notice Get a quote for the best single-route swap
     * @dev Off-chain aggregators should compute optimal splits; this provides a simple best-route quote
     * @param tokenIn Input token address
     * @param tokenOut Output token address
     * @param amountIn Amount of input token
     * @return amountOut Expected output amount
     * @return bestRoute The best single route found
     */
    function getQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut, Route memory bestRoute) {
        if (amountIn == 0) revert ZeroAmount();
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();

        // Check direct pools for this pair
        bytes32 pairKey = _getPairKey(tokenIn, tokenOut);
        address[] storage pools = pairPools[pairKey];

        uint256 bestOutput;

        for (uint256 i; i < pools.length; ++i) {
            address pool = pools[i];
            if (!isRegisteredPool[pool]) continue;

            // Try to get quote from pool
            (bool success, bytes memory data) = pool.staticcall(
                abi.encodeWithSignature(
                    "getAmountOut(address,address,uint256)",
                    tokenIn,
                    tokenOut,
                    amountIn
                )
            );

            if (success && data.length >= 32) {
                uint256 output = abi.decode(data, (uint256));
                if (output > bestOutput) {
                    bestOutput = output;

                    // Build the route
                    bestRoute.path = new address[](2);
                    bestRoute.path[0] = tokenIn;
                    bestRoute.path[1] = tokenOut;

                    bestRoute.pools = new address[](1);
                    bestRoute.pools[0] = pool;

                    bestRoute.poolTypes = new uint256[](1);
                    bestRoute.poolTypes[0] = poolTypes[pool];
                }
            }
        }

        amountOut = bestOutput;
    }

    // ============ Admin Functions ============

    /**
     * @notice Register a pool for routing
     * @param pool Pool contract address
     * @param poolType Type of pool (0=ConstantProduct, 1=StableSwap, 2=BatchAuction)
     */
    function registerPool(address pool, uint256 poolType) external onlyOwner {
        if (pool == address(0)) revert ZeroAddress();
        if (isRegisteredPool[pool]) revert PoolAlreadyRegistered(pool);
        if (poolType > POOL_TYPE_BATCH_AUCTION) revert InvalidPoolType(poolType);

        isRegisteredPool[pool] = true;
        poolTypes[pool] = poolType;
        registeredPools.push(pool);
        _poolIndex[pool] = registeredPools.length; // 1-indexed

        emit PoolRegistered(pool, poolType);
    }

    /**
     * @notice Remove a pool from routing
     * @param pool Pool contract address to remove
     */
    function removePool(address pool) external onlyOwner {
        if (!isRegisteredPool[pool]) revert PoolNotRegistered(pool);

        isRegisteredPool[pool] = false;
        delete poolTypes[pool];

        // Swap-and-pop from registeredPools
        uint256 idx = _poolIndex[pool] - 1; // Convert to 0-indexed
        uint256 lastIdx = registeredPools.length - 1;
        if (idx != lastIdx) {
            address lastPool = registeredPools[lastIdx];
            registeredPools[idx] = lastPool;
            _poolIndex[lastPool] = idx + 1;
        }
        registeredPools.pop();
        delete _poolIndex[pool];

        emit PoolRemoved(pool);
    }

    /**
     * @notice Register a token pair for a pool (enables getQuote discovery)
     * @param pool Pool address
     * @param tokenA First token in the pair
     * @param tokenB Second token in the pair
     */
    function registerPairPool(address pool, address tokenA, address tokenB) external onlyOwner {
        if (!isRegisteredPool[pool]) revert PoolNotRegistered(pool);
        bytes32 key = _getPairKey(tokenA, tokenB);
        pairPools[key].push(pool);
    }

    // ============ View Functions ============

    /**
     * @notice Get count of registered pools
     * @return Number of registered pools
     */
    function getRegisteredPoolCount() external view returns (uint256) {
        return registeredPools.length;
    }

    // ============ Internal Functions ============

    /**
     * @notice Get canonical pair key (sorted)
     * @param tokenA First token
     * @param tokenB Second token
     * @return Pair key hash
     */
    function _getPairKey(address tokenA, address tokenB) internal pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1));
    }

    /**
     * @notice Authorize upgrade (UUPS)
     */
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
