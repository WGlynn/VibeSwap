// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVibeOracle — Unified Oracle Interface for VSOS
 * @notice Every module that needs price data reads through this interface.
 *         Backed by VibeOracleRouter (Chainlink + API3 + Pyth converged).
 */
interface IVibeOracle {
    /// @notice Get the latest price for a feed
    /// @param feedId The feed identifier (keccak256(base, quote))
    /// @return price Price with 18 decimals
    /// @return timestamp When this price was last updated
    /// @return confidence Standard deviation in BPS
    function getPrice(bytes32 feedId) external view returns (uint256 price, uint256 timestamp, uint256 confidence);

    /// @notice Get price without reverting on staleness
    function getPriceUnsafe(bytes32 feedId) external view returns (uint256 price, uint256 timestamp, bool stale);

    /// @notice Get feed ID from token pair
    function getFeedId(string calldata base, string calldata quote) external pure returns (bytes32);

    /// @notice Get price by address (convenience — maps token address to feed)
    function getPriceByAddress(address token) external view returns (uint256 price);
}
