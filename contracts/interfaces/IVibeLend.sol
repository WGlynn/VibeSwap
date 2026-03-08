// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeLend — Unified Lending Interface for VSOS
 * @notice Every module that needs lending/borrowing reads through this interface.
 *         Backed by VibeLendPool (AAVE + MakerDAO + Reserve Rights converged).
 */
interface IVibeLend {
    /// @notice Deposit assets into lending pool
    function deposit(address asset, uint256 amount) external;

    /// @notice Withdraw assets from lending pool
    function withdraw(address asset, uint256 amount) external;

    /// @notice Borrow assets against collateral
    function borrow(address asset, uint256 amount) external;

    /// @notice Repay borrowed assets
    function repay(address asset, uint256 amount) external;

    /// @notice Get health factor for a user (18 decimals, < 1e18 = liquidatable)
    function getHealthFactor(address user) external view returns (uint256);

    /// @notice Get current utilization rate for an asset (18 decimals)
    function getUtilization(address asset) external view returns (uint256);

    /// @notice Get current annual interest rate (18 decimals)
    function getInterestRate(address asset) external view returns (uint256);

    /// @notice Execute flash loan
    function flashLoan(address asset, uint256 amount, bytes calldata data) external;
}

/// @notice Flash loan callback interface
interface IFlashLoanReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 fee,
        bytes calldata data
    ) external returns (bool);
}
