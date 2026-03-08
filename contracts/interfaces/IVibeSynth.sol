// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeSynth — Unified Synthetics Interface for VSOS
 * @notice Backed by VibeSynth + VibePerpEngine (Synthetix + Hyperliquid converged).
 */
interface IVibeSynth {
    /// @notice Open a perpetual position
    /// @param marketId The market to trade
    /// @param size Positive = long, negative = short
    /// @param margin Collateral amount
    /// @param maxPrice Maximum acceptable entry price
    function openPosition(bytes32 marketId, int256 size, uint256 margin, uint256 maxPrice) external returns (uint256 positionId);

    /// @notice Close a perpetual position
    function closePosition(uint256 positionId, uint256 minPrice) external;

    /// @notice Get unrealized PnL for a position
    function getPositionPnL(uint256 positionId) external view returns (int256 pnl);

    /// @notice Get current funding rate for a market (18 decimals, per hour)
    function getFundingRate(bytes32 marketId) external view returns (int256);

    /// @notice Get open interest for a market
    function getOpenInterest(bytes32 marketId) external view returns (uint256 longOI, uint256 shortOI);
}
