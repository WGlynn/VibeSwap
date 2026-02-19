// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IProtocolFeeAdapter
 * @notice Adapter that sits between fee-generating contracts (VibeAMM, CommitRevealAuction)
 *         and the cooperative distribution system (FeeRouter).
 *         Part of VSOS DeFi/DeFAI layer.
 */
interface IProtocolFeeAdapter {
    // ============ Events ============

    event FeeForwarded(address indexed token, uint256 amount, address indexed source);
    event ETHForwarded(uint256 amount, address indexed source);
    event FeeRouterUpdated(address indexed newRouter);
    event SourceRegistered(address indexed source, string name);

    // ============ Errors ============

    error ZeroAddress();
    error ZeroAmount();
    error TransferFailed();
    error NotAuthorized();

    // ============ Actions ============

    /// @notice Receive ERC20 fees and forward to FeeRouter
    function forwardFees(address token) external;

    /// @notice Receive ETH (e.g., priority bids) and convert/forward
    function forwardETH() external payable;

    // ============ Views ============

    function feeRouter() external view returns (address);
    function totalForwarded(address token) external view returns (uint256);
    function totalETHForwarded() external view returns (uint256);
}
