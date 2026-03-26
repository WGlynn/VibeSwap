// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISIEShapleyAdapter
 * @notice Interface for the SIE-to-Shapley bridge, called by IntelligenceExchange
 *         on settlement to accumulate contribution data for periodic true-up.
 */
interface ISIEShapleyAdapter {
    /**
     * @notice Called by IntelligenceExchange when an evaluation settles.
     * @param assetId The settled asset ID
     * @param contributor The asset's contributor address
     * @param verified Whether the asset was verified (true) or disputed (false)
     * @param bondingPrice The asset's current bonding curve price
     * @param citationCount Number of assets this work cites
     */
    function onSettlement(
        bytes32 assetId,
        address contributor,
        bool verified,
        uint256 bondingPrice,
        uint256 citationCount
    ) external;
}
