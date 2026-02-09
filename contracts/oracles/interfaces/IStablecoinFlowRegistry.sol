// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IStablecoinFlowRegistry
 * @notice Interface for tracking USDT/USDC flow ratios and regime indicators
 * @dev Provides stablecoin-based manipulation detection signals
 */
interface IStablecoinFlowRegistry {
    // ============ Events ============

    event FlowRatioUpdated(
        uint256 ratio,
        uint256 avgRatio7d,
        uint64 timestamp
    );

    event RegimeChanged(
        bool usdtDominant,
        bool usdcDominant
    );

    event UpdaterAuthorized(address indexed updater, bool authorized);

    // ============ View Functions ============

    /**
     * @notice Get current USDT/USDC flow ratio
     * @return ratio Current flow ratio (18 decimals)
     */
    function getCurrentFlowRatio() external view returns (uint256 ratio);

    /**
     * @notice Get 7-day average flow ratio
     * @return avgRatio Average ratio (18 decimals)
     */
    function getAverageFlowRatio() external view returns (uint256 avgRatio);

    /**
     * @notice Check if USDT is currently dominant
     * @dev True when ratio > 2.0 (USDT flow exceeds 2x USDC flow)
     * @return True if USDT-dominant
     */
    function isUSDTDominant() external view returns (bool);

    /**
     * @notice Check if USDC is currently dominant
     * @dev True when ratio < 0.5 (USDC flow exceeds 2x USDT flow)
     * @return True if USDC-dominant
     */
    function isUSDCDominant() external view returns (bool);

    /**
     * @notice Get manipulation probability based on flow ratio
     * @dev Uses logistic function: 1 / (1 + exp(-1.5 * (ratio - 2)))
     * @return probability Manipulation probability (18 decimals, 0-1e18)
     */
    function getManipulationProbability() external view returns (uint256 probability);

    /**
     * @notice Get volatility multiplier based on USDT dominance
     * @dev Returns 1.0-3.0x based on flow ratio
     * @return multiplier Volatility multiplier (18 decimals, 1e18-3e18)
     */
    function getVolatilityMultiplier() external view returns (uint256 multiplier);

    /**
     * @notice Get trust reduction factor for spot prices
     * @dev Higher USDT flows = less trust in spot price inputs
     * @return factor Trust reduction (18 decimals, 0-1e18)
     */
    function getTrustReduction() external view returns (uint256 factor);

    /**
     * @notice Get last update timestamp
     * @return timestamp Unix timestamp of last update
     */
    function getLastUpdate() external view returns (uint64 timestamp);

    /**
     * @notice Get historical flow ratios
     * @param count Number of historical entries to return
     * @return ratios Array of historical ratios (most recent first)
     * @return timestamps Array of corresponding timestamps
     */
    function getFlowRatioHistory(uint8 count) external view returns (
        uint256[] memory ratios,
        uint64[] memory timestamps
    );

    // ============ Update Functions ============

    /**
     * @notice Update flow ratio (authorized updaters only)
     * @param newRatio New USDT/USDC flow ratio (18 decimals)
     */
    function updateFlowRatio(uint256 newRatio) external;

    /**
     * @notice Batch update with signature verification
     * @param newRatio New flow ratio
     * @param signature EIP-712 signature
     */
    function updateFlowRatioSigned(uint256 newRatio, bytes calldata signature) external;

    // ============ Admin Functions ============

    /**
     * @notice Set authorized updater status
     * @param updater Updater address
     * @param authorized Authorization status
     */
    function setAuthorizedUpdater(address updater, bool authorized) external;
}
