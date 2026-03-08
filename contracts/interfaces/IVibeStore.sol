// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeStore — Unified Storage/Compute Interface for VSOS
 * @notice Backed by GPUComputeMarket + DataMarketplace (Filecoin + Render converged).
 */
interface IVibeStore {
    /// @notice Post a GPU compute job
    function postJob(uint256 minVRAM, uint256 minTFLOPS, uint256 maxHours, bytes32 inputHash) external payable returns (bytes32 jobId);

    /// @notice Get job status
    function getJobStatus(bytes32 jobId) external view returns (uint8 status, bytes32 resultHash, address provider);

    /// @notice Publish a data asset
    function publishAsset(string calldata metadataURI, bytes32 contentHash, uint256 accessPrice, uint256 computePrice, uint8 assetType) external returns (uint256 assetId);

    /// @notice Check if an address has access to a data asset
    function hasAccess(address user, uint256 assetId) external view returns (bool);
}
