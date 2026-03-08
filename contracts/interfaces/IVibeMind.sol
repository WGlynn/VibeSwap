// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeMind — Unified AI Layer Interface for VSOS
 * @notice Backed by SubnetRouter + DataMarketplace + AgentRegistry.
 *         AI agents are first-class citizens in the protocol.
 */
interface IVibeMind {
    /// @notice Submit an AI task to a subnet
    function submitTask(bytes32 subnetId, bytes32 inputHash, uint256 payment) external returns (bytes32 taskId);

    /// @notice Get task status and result
    function getTaskResult(bytes32 taskId) external view returns (bytes32 outputHash, bool completed, uint256 qualityScore);

    /// @notice Purchase access to a data asset
    function purchaseDataAccess(uint256 assetId) external;

    /// @notice Submit a compute-to-data job
    function submitComputeJob(uint256 assetId, bytes32 algorithmHash) external returns (bytes32 jobId);

    /// @notice Get worker quality score
    function getWorkerQuality(address worker) external view returns (uint256 score);
}
