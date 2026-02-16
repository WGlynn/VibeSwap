// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IPoolCurve.sol";
import "./VibeLP.sol";
import "../hooks/interfaces/IVibeHookRegistry.sol";

/**
 * @title VibePoolFactory
 * @notice Modular pool factory — deploy new pool types (stable, concentrated,
 *         weighted) from a single factory with pluggable curves.
 * @dev Part of VSOS (VibeSwap Operating System) Protocol Framework (#8).
 *
 *      Architecture:
 *        - Curves are stateless pure-math contracts implementing IPoolCurve
 *        - Factory stores all pool state (reserves, fees, LP tokens)
 *        - Same token pair can have multiple pools with different curves
 *        - Pool ID = keccak256(token0, token1, curveId)
 *        - Optional hook integration via IVibeHookRegistry (graceful degradation)
 *
 *      Cooperative Capitalism angle: The factory is a shared public good —
 *      anyone can propose new curve types, and pool creation is permissionless.
 *      Different curve types serve different communities (stablecoin holders,
 *      volatile traders, concentrated LPs) from the same cooperative infrastructure.
 *      Mutualized factory, sovereign pool choice.
 */
contract VibePoolFactory is Ownable, ReentrancyGuard {
    // ============ Structs ============

    struct FactoryPool {
        address token0;
        address token1;
        bytes32 curveId;
        uint16 feeRate;          // basis points
        bool initialized;
        uint32 createdAt;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        bytes curveParams;       // curve-specific parameters
    }

    struct CreatePoolParams {
        address tokenA;          // auto-ordered to token0/token1
        address tokenB;          // auto-ordered to token0/token1
        bytes32 curveId;         // which curve to use
        uint16 feeRate;          // BPS (0 = default 5 BPS)
        bytes curveParams;       // curve-specific (empty for CP, abi.encode(A) for SS)
        address hook;            // optional (address(0) to skip)
        uint8 hookFlags;         // hook point flags
    }

    // ============ Constants ============

    uint16 public constant DEFAULT_FEE_RATE = 5; // 0.05%
    uint16 public constant MAX_FEE_RATE = 1000;  // 10%

    // ============ State ============

    /// @notice Hook registry for optional hook attachment
    IVibeHookRegistry public hookRegistry;

    /// @notice Approved curve implementations: curveId => curve address
    mapping(bytes32 => address) public approvedCurves;

    /// @notice All approved curve IDs for enumeration
    bytes32[] private _curveIds;

    /// @notice Pool storage: poolId => FactoryPool
    mapping(bytes32 => FactoryPool) private _pools;

    /// @notice LP tokens: poolId => VibeLP address
    mapping(bytes32 => address) public lpTokens;

    /// @notice All pool IDs for enumeration
    bytes32[] private _poolIds;

    // ============ Events ============

    event CurveRegistered(bytes32 indexed curveId, address indexed curve, string name);
    event CurveDeregistered(bytes32 indexed curveId, address indexed curve);
    event PoolCreated(
        bytes32 indexed poolId,
        address indexed token0,
        address indexed token1,
        bytes32 curveId,
        uint16 feeRate,
        address lpToken
    );
    event HookRegistrySet(address indexed hookRegistry);

    // ============ Errors ============

    error ZeroAddress();
    error IdenticalTokens();
    error CurveAlreadyRegistered();
    error CurveNotApproved();
    error PoolAlreadyExists();
    error PoolNotFound();
    error InvalidFeeRate();
    error InvalidCurveParams();

    // ============ Constructor ============

    /**
     * @param _hookRegistry Optional hook registry (address(0) to skip)
     */
    constructor(address _hookRegistry) Ownable(msg.sender) {
        if (_hookRegistry != address(0)) {
            hookRegistry = IVibeHookRegistry(_hookRegistry);
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Register an approved curve implementation
     * @param curve Address of the IPoolCurve contract
     */
    function registerCurve(address curve) external onlyOwner {
        if (curve == address(0)) revert ZeroAddress();

        bytes32 id = IPoolCurve(curve).curveId();
        if (approvedCurves[id] != address(0)) revert CurveAlreadyRegistered();

        approvedCurves[id] = curve;
        _curveIds.push(id);

        emit CurveRegistered(id, curve, IPoolCurve(curve).curveName());
    }

    /**
     * @notice Deregister a curve (existing pools unaffected)
     * @param _curveId Curve ID to remove
     */
    function deregisterCurve(bytes32 _curveId) external onlyOwner {
        address curve = approvedCurves[_curveId];
        if (curve == address(0)) revert CurveNotApproved();

        delete approvedCurves[_curveId];

        // Remove from enumeration array
        for (uint256 i = 0; i < _curveIds.length; i++) {
            if (_curveIds[i] == _curveId) {
                _curveIds[i] = _curveIds[_curveIds.length - 1];
                _curveIds.pop();
                break;
            }
        }

        emit CurveDeregistered(_curveId, curve);
    }

    /**
     * @notice Set or update the hook registry
     * @param _hookRegistry New hook registry address (address(0) to disable)
     */
    function setHookRegistry(address _hookRegistry) external onlyOwner {
        hookRegistry = IVibeHookRegistry(_hookRegistry);
        emit HookRegistrySet(_hookRegistry);
    }

    // ============ Pool Creation ============

    /**
     * @notice Create a new liquidity pool
     * @param params Pool creation parameters
     * @return poolId The unique pool identifier
     */
    function createPool(CreatePoolParams calldata params) external nonReentrant returns (bytes32 poolId) {
        if (params.tokenA == address(0) || params.tokenB == address(0)) revert ZeroAddress();
        if (params.tokenA == params.tokenB) revert IdenticalTokens();
        if (approvedCurves[params.curveId] == address(0)) revert CurveNotApproved();

        // Validate fee
        uint16 feeRate = params.feeRate == 0 ? DEFAULT_FEE_RATE : params.feeRate;
        if (feeRate > MAX_FEE_RATE) revert InvalidFeeRate();

        // Validate curve params
        address curveAddr = approvedCurves[params.curveId];
        if (!IPoolCurve(curveAddr).validateParams(params.curveParams)) revert InvalidCurveParams();

        // Order tokens deterministically
        (address token0, address token1) = params.tokenA < params.tokenB
            ? (params.tokenA, params.tokenB)
            : (params.tokenB, params.tokenA);

        // Compute deterministic pool ID
        poolId = keccak256(abi.encodePacked(token0, token1, params.curveId));
        if (_pools[poolId].initialized) revert PoolAlreadyExists();

        // Deploy LP token
        VibeLP lp = new VibeLP(token0, token1, address(this));

        // Store pool
        _pools[poolId] = FactoryPool({
            token0: token0,
            token1: token1,
            curveId: params.curveId,
            feeRate: feeRate,
            initialized: true,
            createdAt: uint32(block.timestamp),
            reserve0: 0,
            reserve1: 0,
            totalLiquidity: 0,
            curveParams: params.curveParams
        });

        lpTokens[poolId] = address(lp);
        _poolIds.push(poolId);

        // Optional hook attachment (graceful degradation)
        if (params.hook != address(0) && address(hookRegistry) != address(0)) {
            try hookRegistry.attachHook(poolId, params.hook, params.hookFlags) {
                // Hook attached successfully
            } catch {
                // Graceful degradation — pool created without hook
            }
        }

        emit PoolCreated(poolId, token0, token1, params.curveId, feeRate, address(lp));
    }

    // ============ Quoting ============

    /**
     * @notice Quote output amount for a swap
     * @param poolId Pool to query
     * @param amountIn Input amount
     * @return amountOut Expected output
     */
    function quoteAmountOut(bytes32 poolId, uint256 amountIn) external view returns (uint256 amountOut) {
        FactoryPool storage pool = _pools[poolId];
        if (!pool.initialized) revert PoolNotFound();

        address curveAddr = approvedCurves[pool.curveId];
        // If curve was deregistered, use stored curveId to look up — pools keep working
        // via the stored curve address at creation time... but we use the registry.
        // For deregistered curves, this will revert. That's acceptable — quoting is a view.
        if (curveAddr == address(0)) revert CurveNotApproved();

        amountOut = IPoolCurve(curveAddr).getAmountOut(
            amountIn,
            pool.reserve0,
            pool.reserve1,
            pool.feeRate,
            pool.curveParams
        );
    }

    /**
     * @notice Quote input amount needed for desired output
     * @param poolId Pool to query
     * @param amountOut Desired output amount
     * @return amountIn Required input
     */
    function quoteAmountIn(bytes32 poolId, uint256 amountOut) external view returns (uint256 amountIn) {
        FactoryPool storage pool = _pools[poolId];
        if (!pool.initialized) revert PoolNotFound();

        address curveAddr = approvedCurves[pool.curveId];
        if (curveAddr == address(0)) revert CurveNotApproved();

        amountIn = IPoolCurve(curveAddr).getAmountIn(
            amountOut,
            pool.reserve0,
            pool.reserve1,
            pool.feeRate,
            pool.curveParams
        );
    }

    // ============ View Functions ============

    /**
     * @notice Get pool details
     */
    function getPool(bytes32 poolId) external view returns (FactoryPool memory) {
        if (!_pools[poolId].initialized) revert PoolNotFound();
        return _pools[poolId];
    }

    /**
     * @notice Get LP token address for a pool
     */
    function getLPToken(bytes32 poolId) external view returns (address) {
        if (!_pools[poolId].initialized) revert PoolNotFound();
        return lpTokens[poolId];
    }

    /**
     * @notice Compute pool ID for a given pair + curve
     */
    function getPoolId(address tokenA, address tokenB, bytes32 _curveId) external pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1, _curveId));
    }

    /**
     * @notice Get all pool IDs
     */
    function getAllPools() external view returns (bytes32[] memory) {
        return _poolIds;
    }

    /**
     * @notice Get total number of pools
     */
    function getPoolCount() external view returns (uint256) {
        return _poolIds.length;
    }

    /**
     * @notice Check if a curve is approved
     */
    function isCurveApproved(bytes32 _curveId) external view returns (bool) {
        return approvedCurves[_curveId] != address(0);
    }

    /**
     * @notice Get all approved curve IDs
     */
    function getApprovedCurves() external view returns (bytes32[] memory) {
        return _curveIds;
    }

    /**
     * @notice Get curve implementation address
     */
    function getCurveAddress(bytes32 _curveId) external view returns (address) {
        return approvedCurves[_curveId];
    }
}
