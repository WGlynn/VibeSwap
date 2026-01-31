// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeAMM
 * @notice Interface for the constant product AMM with batch execution
 */
interface IVibeAMM {
    // ============ Structs ============

    struct Pool {
        address token0;
        address token1;
        uint256 reserve0;
        uint256 reserve1;
        uint256 totalLiquidity;
        uint256 feeRate; // In basis points (e.g., 30 = 0.3%)
        bool initialized;
    }

    struct SwapOrder {
        address trader;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        bool isPriority;
    }

    struct BatchSwapResult {
        uint256 clearingPrice; // tokenOut per tokenIn (scaled by 1e18)
        uint256 totalTokenInSwapped;
        uint256 totalTokenOutSwapped;
        uint256 protocolFees;
    }

    // ============ Events ============

    event PoolCreated(
        bytes32 indexed poolId,
        address indexed token0,
        address indexed token1,
        uint256 feeRate
    );

    event LiquidityAdded(
        bytes32 indexed poolId,
        address indexed provider,
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity
    );

    event LiquidityRemoved(
        bytes32 indexed poolId,
        address indexed provider,
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity
    );

    event BatchSwapExecuted(
        bytes32 indexed poolId,
        uint64 indexed batchId,
        uint256 clearingPrice,
        uint256 orderCount,
        uint256 protocolFees
    );

    event SwapExecuted(
        bytes32 indexed poolId,
        address indexed trader,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    // ============ Functions ============

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
    ) external returns (bytes32 poolId);

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
    ) external returns (uint256 amount0, uint256 amount1, uint256 liquidity);

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
    ) external returns (uint256 amount0, uint256 amount1);

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
    ) external returns (BatchSwapResult memory result);

    /**
     * @notice Get pool information
     */
    function getPool(bytes32 poolId) external view returns (Pool memory);

    /**
     * @notice Get pool ID for a token pair
     */
    function getPoolId(address tokenA, address tokenB) external pure returns (bytes32);

    /**
     * @notice Quote output amount for a swap
     */
    function quote(
        bytes32 poolId,
        address tokenIn,
        uint256 amountIn
    ) external view returns (uint256 amountOut);

    /**
     * @notice Get LP token address for a pool
     */
    function getLPToken(bytes32 poolId) external view returns (address);
}
