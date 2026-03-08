// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeRouter — Unified Trading Interface for VSOS
 * @notice Every module that needs to execute swaps reads through this interface.
 *         Backed by VibeRouter (Jupiter-style multi-path aggregation).
 */
interface IVibeRouter {
    struct Route {
        address[] path;
        address[] pools;
        uint256[] poolTypes;     // 0 = ConstantProduct, 1 = StableSwap, 2 = BatchAuction
    }

    struct SwapParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        Route[] routes;
        uint256[] splitBps;
        uint256 deadline;
    }

    /// @notice Execute a multi-route swap
    function swap(SwapParams calldata params) external returns (uint256 amountOut);

    /// @notice Get best quote for a swap
    function getQuote(address tokenIn, address tokenOut, uint256 amountIn)
        external view returns (uint256 amountOut, Route memory bestRoute);
}
