// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeAnalytics — Protocol Metrics Interface
 * @notice On-chain protocol health metrics for dashboards and governance.
 */
interface IVibeAnalytics {
    /// @notice Get aggregate protocol metrics
    function getProtocolMetrics() external view returns (
        uint256 tvl,
        uint256 dailyVolume,
        uint256 totalVolume,
        uint256 uniqueUsers,
        uint256 totalTransactions,
        uint256 totalFeeRevenue
    );

    /// @notice Report metrics from a module
    function reportMetrics(
        string calldata moduleName,
        uint256 tvl,
        uint256 volume,
        uint256 users,
        uint256 transactions,
        uint256 revenue
    ) external;

    /// @notice Take a metrics snapshot
    function takeSnapshot() external;
}
