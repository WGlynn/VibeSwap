// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ITruePriceOracle
 * @notice Interface for True Price Oracle - Bayesian equilibrium price estimation
 * @dev Receives signed updates from off-chain Kalman filter
 */
interface ITruePriceOracle {
    // ============ Enums ============

    enum RegimeType {
        NORMAL,          // Default market conditions
        TREND,           // USDC-dominant, genuine price discovery
        LOW_VOLATILITY,  // Stable, low leverage, tight bands
        HIGH_LEVERAGE,   // Elevated leverage but no cascade
        MANIPULATION,    // USDT-dominant, leverage-driven distortion
        CASCADE          // Active liquidation cascade
    }

    // ============ Structs ============

    struct TruePriceData {
        uint256 price;              // True Price estimate (18 decimals)
        uint256 confidence;         // Confidence interval width (18 decimals)
        int256 deviationZScore;     // Z-score of spot vs true (signed, 18 decimals)
        RegimeType regime;          // Current regime classification
        uint256 manipulationProb;   // Manipulation probability (18 decimals, 0-1e18)
        uint64 timestamp;           // Update timestamp
        bytes32 dataHash;           // Hash of off-chain data used for verification
    }

    struct StablecoinContext {
        uint256 usdtUsdcRatio;        // USDT/USDC flow ratio (18 decimals)
        bool usdtDominant;            // True if ratio > 2.0
        bool usdcDominant;            // True if ratio < 0.5
        uint256 volatilityMultiplier; // Observation noise multiplier (18 decimals, 1e18-3e18)
    }

    // ============ Events ============

    event TruePriceUpdated(
        bytes32 indexed poolId,
        uint256 price,
        int256 deviationZScore,
        RegimeType regime,
        uint256 manipulationProb,
        uint64 timestamp
    );

    event StablecoinContextUpdated(
        uint256 usdtUsdcRatio,
        bool usdtDominant,
        bool usdcDominant,
        uint256 volatilityMultiplier
    );

    event OracleSignerUpdated(address indexed signer, bool authorized);

    // ============ View Functions ============

    /**
     * @notice Get current True Price data for a pool
     * @param poolId Pool identifier
     * @return data TruePriceData struct with all price information
     */
    function getTruePrice(bytes32 poolId) external view returns (TruePriceData memory data);

    /**
     * @notice Get current stablecoin context (global)
     * @return context StablecoinContext struct
     */
    function getStablecoinContext() external view returns (StablecoinContext memory context);

    /**
     * @notice Get deviation metrics for a pool
     * @param poolId Pool identifier
     * @return truePrice The True Price estimate
     * @return deviationZScore Z-score of current deviation
     * @return manipulationProb Probability of manipulation
     */
    function getDeviationMetrics(bytes32 poolId) external view returns (
        uint256 truePrice,
        int256 deviationZScore,
        uint256 manipulationProb
    );

    /**
     * @notice Check if manipulation is likely above threshold
     * @param poolId Pool identifier
     * @param threshold Probability threshold (18 decimals)
     * @return True if manipulation probability exceeds threshold
     */
    function isManipulationLikely(bytes32 poolId, uint256 threshold) external view returns (bool);

    /**
     * @notice Get current regime for a pool
     * @param poolId Pool identifier
     * @return regime Current RegimeType
     */
    function getRegime(bytes32 poolId) external view returns (RegimeType regime);

    /**
     * @notice Check if True Price data is fresh
     * @param poolId Pool identifier
     * @param maxAge Maximum acceptable age in seconds
     * @return True if data is fresh
     */
    function isFresh(bytes32 poolId, uint256 maxAge) external view returns (bool);

    /**
     * @notice Get price bounds based on True Price and stablecoin context
     * @param poolId Pool identifier
     * @param baseDeviationBps Base max deviation in basis points
     * @return lowerBound Lower acceptable price bound
     * @return upperBound Upper acceptable price bound
     */
    function getPriceBounds(bytes32 poolId, uint256 baseDeviationBps) external view returns (
        uint256 lowerBound,
        uint256 upperBound
    );

    // ============ Update Functions (authorized signers only) ============

    /**
     * @notice Update True Price for a pool
     * @param poolId Pool identifier
     * @param price True Price estimate (18 decimals)
     * @param confidence Confidence interval width
     * @param deviationZScore Z-score of deviation
     * @param regime Regime classification
     * @param manipulationProb Manipulation probability
     * @param dataHash Hash of source data
     * @param signature EIP-712 signature with nonce and deadline
     */
    function updateTruePrice(
        bytes32 poolId,
        uint256 price,
        uint256 confidence,
        int256 deviationZScore,
        RegimeType regime,
        uint256 manipulationProb,
        bytes32 dataHash,
        bytes calldata signature
    ) external;

    /**
     * @notice Update stablecoin context (global)
     * @param usdtUsdcRatio USDT/USDC flow ratio
     * @param usdtDominant USDT dominance flag
     * @param usdcDominant USDC dominance flag
     * @param volatilityMultiplier Observation noise multiplier
     * @param signature EIP-712 signature
     */
    function updateStablecoinContext(
        uint256 usdtUsdcRatio,
        bool usdtDominant,
        bool usdcDominant,
        uint256 volatilityMultiplier,
        bytes calldata signature
    ) external;

    // ============ Admin Functions ============

    /**
     * @notice Set authorized signer status
     * @param signer Signer address
     * @param authorized Authorization status
     */
    function setAuthorizedSigner(address signer, bool authorized) external;
}
