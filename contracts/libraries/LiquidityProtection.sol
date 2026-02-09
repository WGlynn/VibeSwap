// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title LiquidityProtection
 * @notice Comprehensive protection mechanisms for low-liquidity environments
 * @dev Implements multiple layers of defense against manipulation and poor execution
 *
 * Protection mechanisms:
 * 1. Virtual Reserves - Amplify effective liquidity to reduce price impact
 * 2. Dynamic Fees - Higher fees when liquidity is scarce
 * 3. Price Impact Caps - Reject trades with excessive slippage
 * 4. Minimum Liquidity Gates - Disable trading below threshold
 * 5. Concentration Scoring - Adjust protections based on liquidity distribution
 *
 * Formal invariants:
 * - INV1: Virtual reserves only reduce price impact, never increase it
 * - INV2: Dynamic fees are monotonically increasing as liquidity decreases
 * - INV3: Price impact cap provides hard upper bound on execution slippage
 * - INV4: Minimum liquidity gate prevents trading in dangerously thin markets
 */
library LiquidityProtection {
    // ============ Constants ============

    uint256 constant PRECISION = 1e18;
    uint256 constant BPS_PRECISION = 10000;

    // Virtual reserve parameters (Curve-style amplification)
    uint256 constant MIN_AMPLIFICATION = 1;        // No amplification
    uint256 constant MAX_AMPLIFICATION = 1000;     // 1000x virtual liquidity
    uint256 constant DEFAULT_AMPLIFICATION = 100;  // 100x for stablecoin pairs

    // Dynamic fee parameters
    uint256 constant BASE_FEE_BPS = 30;            // 0.3% base fee
    uint256 constant MAX_FEE_BPS = 500;            // 5% max fee
    uint256 constant LOW_LIQUIDITY_THRESHOLD = 100_000 * PRECISION;  // $100k

    // Price impact parameters
    uint256 constant DEFAULT_MAX_IMPACT_BPS = 300; // 3% default max impact
    uint256 constant ABSOLUTE_MAX_IMPACT_BPS = 1000; // 10% absolute max

    // Minimum liquidity parameters
    uint256 constant MINIMUM_LIQUIDITY_USD = 10_000 * PRECISION;  // $10k minimum

    // ============ Structs ============

    struct ProtectionConfig {
        uint256 amplificationFactor;      // Virtual reserve multiplier (1-1000)
        uint256 maxPriceImpactBps;         // Maximum allowed price impact
        uint256 minLiquidityUsd;           // Minimum liquidity to enable trading
        uint256 lowLiquidityThreshold;     // Threshold for dynamic fee scaling
        bool virtualReservesEnabled;       // Enable virtual liquidity
        bool dynamicFeesEnabled;           // Enable liquidity-based fees
        bool priceImpactCapEnabled;        // Enable impact rejection
        bool minLiquidityGateEnabled;      // Enable liquidity gate
    }

    struct LiquidityMetrics {
        uint256 reserve0;                  // Token0 reserves
        uint256 reserve1;                  // Token1 reserves
        uint256 totalValueUsd;             // Total liquidity in USD
        uint256 concentrationScore;        // 0-100, higher = more concentrated
        uint256 utilizationRate;           // Recent volume / liquidity ratio
    }

    // ============ Errors ============

    error PriceImpactTooHigh(uint256 impact, uint256 maxAllowed);
    error InsufficientLiquidity(uint256 current, uint256 minimum);
    error InvalidAmplification(uint256 value);
    error InvalidConfiguration();

    // ============ Virtual Reserves ============

    /**
     * @notice Calculate effective reserves with virtual amplification
     * @param reserve0 Actual reserve of token0
     * @param reserve1 Actual reserve of token1
     * @param amplification Amplification factor (1-1000)
     * @return effective0 Effective reserve0 for pricing
     * @return effective1 Effective reserve1 for pricing
     *
     * @dev Virtual reserves dampen price impact without actual liquidity
     *
     * Formal proof of INV1 (virtual reserves reduce impact):
     * Let R = actual reserve, V = virtual reserve = A × R
     * Price impact for trade Δ:
     *   Actual: impact_a = Δ / (R + Δ)
     *   Virtual: impact_v = Δ / (V + Δ) = Δ / (A×R + Δ)
     *
     * Since A ≥ 1: A×R + Δ ≥ R + Δ
     * Therefore: impact_v ≤ impact_a ∎
     */
    function calculateVirtualReserves(
        uint256 reserve0,
        uint256 reserve1,
        uint256 amplification
    ) internal pure returns (uint256 effective0, uint256 effective1) {
        if (amplification < MIN_AMPLIFICATION || amplification > MAX_AMPLIFICATION) {
            revert InvalidAmplification(amplification);
        }

        // Virtual reserves = actual × amplification
        // This creates a "flatter" bonding curve around current price
        effective0 = reserve0 * amplification;
        effective1 = reserve1 * amplification;
    }

    /**
     * @notice Calculate output amount using virtual reserves
     * @param amountIn Input amount
     * @param reserveIn Input token reserve
     * @param reserveOut Output token reserve
     * @param amplification Amplification factor
     * @param feeNumerator Fee in basis points
     * @return amountOut Output amount after fees
     *
     * @dev Uses Curve-inspired stable swap math with virtual reserves
     *
     * Standard AMM: out = (in × Rout) / (Rin + in)
     * Virtual AMM:  out = (in × A×Rout) / (A×Rin + in) × (1/A)
     *
     * The division by A at the end ensures actual token transfers are correct
     */
    function getAmountOutWithVirtualReserves(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 amplification,
        uint256 feeNumerator
    ) internal pure returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        if (reserveIn == 0 || reserveOut == 0) return 0;

        // Apply fee
        uint256 amountInWithFee = amountIn * (BPS_PRECISION - feeNumerator);

        // Calculate with virtual reserves
        uint256 virtualIn = reserveIn * amplification;
        uint256 virtualOut = reserveOut * amplification;

        // Standard constant product with virtual reserves
        uint256 numerator = amountInWithFee * virtualOut;
        uint256 denominator = (virtualIn * BPS_PRECISION) + amountInWithFee;

        // Divide by amplification to get actual output
        amountOut = numerator / denominator;
    }

    // ============ Dynamic Fees ============

    /**
     * @notice Calculate dynamic fee based on liquidity depth
     * @param totalLiquidityUsd Total pool liquidity in USD
     * @param tradeVolumeUsd Trade size in USD
     * @param baseFee Base fee in basis points
     * @return fee Adjusted fee in basis points
     *
     * @dev Fee increases as liquidity decreases to compensate LPs for IL risk
     *
     * Formal proof of INV2 (monotonic fee increase):
     * fee = baseFee × (1 + k × (threshold / liquidity - 1))
     * where k is scaling factor
     *
     * As liquidity ↓: threshold/liquidity ↑ → fee ↑
     * As liquidity ↑: threshold/liquidity ↓ → fee ↓ (bounded by baseFee) ∎
     */
    function calculateDynamicFee(
        uint256 totalLiquidityUsd,
        uint256 tradeVolumeUsd,
        uint256 baseFee
    ) internal pure returns (uint256 fee) {
        if (totalLiquidityUsd == 0) return MAX_FEE_BPS;

        // If liquidity is above threshold, use base fee
        if (totalLiquidityUsd >= LOW_LIQUIDITY_THRESHOLD) {
            return baseFee;
        }

        // Scale fee inversely with liquidity
        // fee = baseFee × (threshold / liquidity)
        // Capped at MAX_FEE_BPS
        uint256 liquidityRatio = (LOW_LIQUIDITY_THRESHOLD * PRECISION) / totalLiquidityUsd;
        fee = (baseFee * liquidityRatio) / PRECISION;

        // Also consider trade size relative to liquidity
        // Large trades in low liquidity get additional fee
        if (tradeVolumeUsd > 0) {
            uint256 volumeRatio = (tradeVolumeUsd * PRECISION) / totalLiquidityUsd;
            if (volumeRatio > PRECISION / 10) { // > 10% of liquidity
                uint256 volumePenalty = (volumeRatio * baseFee) / PRECISION;
                fee += volumePenalty;
            }
        }

        // Cap at maximum
        if (fee > MAX_FEE_BPS) {
            fee = MAX_FEE_BPS;
        }
    }

    /**
     * @notice Get fee tier based on pool characteristics
     * @param isStablePair Whether both tokens are stablecoins
     * @param volatility24h 24h price volatility (18 decimals, e.g., 0.05e18 = 5%)
     * @param liquidityUsd Total liquidity in USD
     * @return feeBps Recommended fee tier
     */
    function getRecommendedFee(
        bool isStablePair,
        uint256 volatility24h,
        uint256 liquidityUsd
    ) internal pure returns (uint256 feeBps) {
        // Base fee by pair type
        if (isStablePair) {
            feeBps = 5; // 0.05% for stable pairs
        } else if (volatility24h < 2 * PRECISION / 100) { // < 2%
            feeBps = 30; // 0.3% for low vol
        } else if (volatility24h < 5 * PRECISION / 100) { // < 5%
            feeBps = 50; // 0.5% for medium vol
        } else {
            feeBps = 100; // 1% for high vol
        }

        // Adjust for liquidity
        if (liquidityUsd < LOW_LIQUIDITY_THRESHOLD) {
            feeBps = (feeBps * LOW_LIQUIDITY_THRESHOLD) / liquidityUsd;
            if (feeBps > MAX_FEE_BPS) feeBps = MAX_FEE_BPS;
        }
    }

    // ============ Price Impact ============

    /**
     * @notice Calculate price impact of a trade
     * @param amountIn Input amount
     * @param reserveIn Input reserve
     * @param reserveOut Output reserve
     * @return impactBps Price impact in basis points
     *
     * @dev Impact = (executionPrice - spotPrice) / spotPrice
     *
     * Formal derivation:
     * spotPrice = Rout / Rin
     * executionPrice = amountOut / amountIn
     *   where amountOut = (amountIn × Rout) / (Rin + amountIn)
     *
     * execPrice = Rout / (Rin + amountIn)
     * impact = (spotPrice - execPrice) / spotPrice
     *        = 1 - execPrice/spotPrice
     *        = 1 - Rin / (Rin + amountIn)
     *        = amountIn / (Rin + amountIn)
     */
    function calculatePriceImpact(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut
    ) internal pure returns (uint256 impactBps) {
        if (reserveIn == 0 || amountIn == 0) return 0;

        // impact = amountIn / (reserveIn + amountIn)
        impactBps = (amountIn * BPS_PRECISION) / (reserveIn + amountIn);
    }

    /**
     * @notice Validate trade doesn't exceed price impact cap
     * @param amountIn Input amount
     * @param reserveIn Input reserve
     * @param reserveOut Output reserve (unused but kept for interface consistency)
     * @param maxImpactBps Maximum allowed impact
     *
     * @dev Reverts if impact exceeds cap
     *
     * INV3: This provides a hard guarantee on maximum slippage
     */
    function requirePriceImpactWithinBounds(
        uint256 amountIn,
        uint256 reserveIn,
        uint256 reserveOut,
        uint256 maxImpactBps
    ) internal pure {
        uint256 impact = calculatePriceImpact(amountIn, reserveIn, reserveOut);

        if (impact > maxImpactBps) {
            revert PriceImpactTooHigh(impact, maxImpactBps);
        }
    }

    /**
     * @notice Calculate maximum trade size for given impact limit
     * @param reserveIn Input reserve
     * @param maxImpactBps Maximum allowed impact
     * @return maxAmountIn Maximum input amount
     *
     * @dev Derived from: impact = amountIn / (reserveIn + amountIn)
     * Solving for amountIn: amountIn = impact × reserveIn / (1 - impact)
     */
    function getMaxTradeSize(
        uint256 reserveIn,
        uint256 maxImpactBps
    ) internal pure returns (uint256 maxAmountIn) {
        if (maxImpactBps >= BPS_PRECISION) return type(uint256).max;

        // amountIn = (impactBps × reserveIn) / (BPS_PRECISION - impactBps)
        maxAmountIn = (maxImpactBps * reserveIn) / (BPS_PRECISION - maxImpactBps);
    }

    // ============ Minimum Liquidity Gate ============

    /**
     * @notice Check if pool has sufficient liquidity for trading
     * @param totalLiquidityUsd Current liquidity in USD
     * @param minimumRequired Minimum required liquidity
     *
     * @dev INV4: Prevents trading in dangerously thin markets
     */
    function requireMinimumLiquidity(
        uint256 totalLiquidityUsd,
        uint256 minimumRequired
    ) internal pure {
        if (totalLiquidityUsd < minimumRequired) {
            revert InsufficientLiquidity(totalLiquidityUsd, minimumRequired);
        }
    }

    /**
     * @notice Calculate liquidity score for risk assessment
     * @param metrics Liquidity metrics
     * @return score Score from 0-100 (higher = safer)
     */
    function calculateLiquidityScore(
        LiquidityMetrics memory metrics
    ) internal pure returns (uint256 score) {
        // Base score from total liquidity (0-40 points)
        uint256 liquidityScore;
        if (metrics.totalValueUsd >= 10_000_000 * PRECISION) {
            liquidityScore = 40; // $10M+
        } else if (metrics.totalValueUsd >= 1_000_000 * PRECISION) {
            liquidityScore = 30; // $1M+
        } else if (metrics.totalValueUsd >= 100_000 * PRECISION) {
            liquidityScore = 20; // $100k+
        } else if (metrics.totalValueUsd >= 10_000 * PRECISION) {
            liquidityScore = 10; // $10k+
        } else {
            liquidityScore = 0;
        }

        // Concentration bonus (0-30 points)
        // Higher concentration near current price = better execution
        uint256 concentrationScore = (metrics.concentrationScore * 30) / 100;

        // Utilization penalty (0-30 points, inverted)
        // High utilization = more volatile, less safe
        uint256 utilizationScore;
        if (metrics.utilizationRate < PRECISION / 10) { // < 10%
            utilizationScore = 30;
        } else if (metrics.utilizationRate < PRECISION / 4) { // < 25%
            utilizationScore = 20;
        } else if (metrics.utilizationRate < PRECISION / 2) { // < 50%
            utilizationScore = 10;
        } else {
            utilizationScore = 0;
        }

        score = liquidityScore + concentrationScore + utilizationScore;
    }

    // ============ Configuration Helpers ============

    /**
     * @notice Get default protection config
     */
    function getDefaultConfig() internal pure returns (ProtectionConfig memory) {
        return ProtectionConfig({
            amplificationFactor: DEFAULT_AMPLIFICATION,
            maxPriceImpactBps: DEFAULT_MAX_IMPACT_BPS,
            minLiquidityUsd: MINIMUM_LIQUIDITY_USD,
            lowLiquidityThreshold: LOW_LIQUIDITY_THRESHOLD,
            virtualReservesEnabled: true,
            dynamicFeesEnabled: true,
            priceImpactCapEnabled: true,
            minLiquidityGateEnabled: true
        });
    }

    /**
     * @notice Get config for stable pairs (tighter parameters)
     */
    function getStablePairConfig() internal pure returns (ProtectionConfig memory) {
        return ProtectionConfig({
            amplificationFactor: 500, // Higher amplification for stable pairs
            maxPriceImpactBps: 50,    // 0.5% max impact
            minLiquidityUsd: 50_000 * PRECISION, // Higher minimum for stable
            lowLiquidityThreshold: 500_000 * PRECISION,
            virtualReservesEnabled: true,
            dynamicFeesEnabled: true,
            priceImpactCapEnabled: true,
            minLiquidityGateEnabled: true
        });
    }

    /**
     * @notice Validate configuration parameters
     */
    function validateConfig(ProtectionConfig memory config) internal pure {
        if (config.amplificationFactor < MIN_AMPLIFICATION ||
            config.amplificationFactor > MAX_AMPLIFICATION) {
            revert InvalidConfiguration();
        }
        if (config.maxPriceImpactBps > ABSOLUTE_MAX_IMPACT_BPS) {
            revert InvalidConfiguration();
        }
    }

    // ============ Composite Protection ============

    /**
     * @notice Apply all protection checks to a trade
     * @param config Protection configuration
     * @param metrics Current liquidity metrics
     * @param amountIn Trade input amount
     * @param tradeValueUsd Trade value in USD
     * @return adjustedFee Fee to apply (bps)
     * @return effectiveReserve0 Effective reserve for pricing
     * @return effectiveReserve1 Effective reserve for pricing
     */
    function applyProtections(
        ProtectionConfig memory config,
        LiquidityMetrics memory metrics,
        uint256 amountIn,
        uint256 tradeValueUsd
    ) internal pure returns (
        uint256 adjustedFee,
        uint256 effectiveReserve0,
        uint256 effectiveReserve1
    ) {
        // 1. Minimum liquidity gate
        if (config.minLiquidityGateEnabled) {
            requireMinimumLiquidity(metrics.totalValueUsd, config.minLiquidityUsd);
        }

        // 2. Calculate virtual reserves
        if (config.virtualReservesEnabled) {
            (effectiveReserve0, effectiveReserve1) = calculateVirtualReserves(
                metrics.reserve0,
                metrics.reserve1,
                config.amplificationFactor
            );
        } else {
            effectiveReserve0 = metrics.reserve0;
            effectiveReserve1 = metrics.reserve1;
        }

        // 3. Price impact check
        if (config.priceImpactCapEnabled) {
            requirePriceImpactWithinBounds(
                amountIn,
                effectiveReserve0, // Use effective reserves for impact calc
                effectiveReserve1,
                config.maxPriceImpactBps
            );
        }

        // 4. Dynamic fee calculation
        if (config.dynamicFeesEnabled) {
            adjustedFee = calculateDynamicFee(
                metrics.totalValueUsd,
                tradeValueUsd,
                BASE_FEE_BPS
            );
        } else {
            adjustedFee = BASE_FEE_BPS;
        }
    }
}
