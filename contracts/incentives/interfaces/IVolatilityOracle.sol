// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IVolatilityOracle
 * @notice Interface for volatility calculation and dynamic fee multipliers
 */
interface IVolatilityOracle {
    enum VolatilityTier { LOW, MEDIUM, HIGH, EXTREME }

    event VolatilityUpdated(bytes32 indexed poolId, uint256 volatility, VolatilityTier tier);
    event FeeMultiplierChanged(VolatilityTier tier, uint256 multiplier);

    /**
     * @notice Calculate realized volatility for a pool over a period
     * @param poolId The pool identifier
     * @param period Time period in seconds for volatility calculation
     * @return volatility Annualized volatility in basis points (10000 = 100%)
     */
    function calculateRealizedVolatility(bytes32 poolId, uint32 period) external view returns (uint256 volatility);

    /**
     * @notice Get the dynamic fee multiplier based on current volatility
     * @param poolId The pool identifier
     * @return multiplier Fee multiplier scaled by 1e18 (1e18 = 1x)
     */
    function getDynamicFeeMultiplier(bytes32 poolId) external view returns (uint256 multiplier);

    /**
     * @notice Get the current volatility tier for a pool
     * @param poolId The pool identifier
     * @return tier The volatility tier (LOW, MEDIUM, HIGH, EXTREME)
     */
    function getVolatilityTier(bytes32 poolId) external view returns (VolatilityTier tier);

    /**
     * @notice Update volatility calculation for a pool (called after swaps)
     * @param poolId The pool identifier
     */
    function updateVolatility(bytes32 poolId) external;

    /**
     * @notice Get cached volatility data for a pool
     * @param poolId The pool identifier
     * @return volatility Current volatility in bps
     * @return tier Current tier
     * @return lastUpdate Timestamp of last update
     */
    function getVolatilityData(bytes32 poolId) external view returns (
        uint256 volatility,
        VolatilityTier tier,
        uint64 lastUpdate
    );
}
