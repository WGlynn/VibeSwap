// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "../incentives/interfaces/IVolatilityOracle.sol";
import "../core/interfaces/IVibeAMM.sol";

/**
 * @title VolatilityOracle
 * @notice Calculates realized volatility from price observations and provides dynamic fee multipliers
 * @dev Uses variance of log returns over a rolling window for volatility estimation
 */
contract VolatilityOracle is
    IVolatilityOracle,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    // ============ Constants ============

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BPS_PRECISION = 10000;
    uint32 public constant DEFAULT_VOLATILITY_WINDOW = 1 hours;
    uint32 public constant OBSERVATION_INTERVAL = 5 minutes;
    uint8 public constant MAX_OBSERVATIONS = 24; // 2 hours of 5-min observations

    /// @notice sqrt(365.25 * 24 * 12) = sqrt(105,192) ≈ 324 — annualization factor for 5-min observations
    uint256 private constant ANNUALIZATION_FACTOR = 324;

    // Volatility tier thresholds (annualized, in bps)
    uint256 public constant LOW_THRESHOLD = 2000;      // 0-20%
    uint256 public constant MEDIUM_THRESHOLD = 5000;   // 20-50%
    uint256 public constant HIGH_THRESHOLD = 10000;    // 50-100%
    // Above 100% = EXTREME

    // Fee multipliers (scaled by 1e18)
    uint256 public constant LOW_MULTIPLIER = 1e18;           // 1.0x
    uint256 public constant MEDIUM_MULTIPLIER = 1.25e18;     // 1.25x
    uint256 public constant HIGH_MULTIPLIER = 1.5e18;        // 1.5x
    uint256 public constant EXTREME_MULTIPLIER = 2e18;       // 2.0x

    // ============ Structs ============

    struct PriceObservation {
        uint64 timestamp;
        uint192 price;
    }

    struct PoolVolatilityData {
        PriceObservation[24] observations;  // Ring buffer
        uint8 index;
        uint8 count;
        uint256 cachedVolatility;           // Cached for gas efficiency
        uint64 lastCacheUpdate;
    }

    // ============ State ============

    IVibeAMM public vibeAMM;
    mapping(bytes32 => PoolVolatilityData) public poolData;

    // Configurable multipliers per tier
    mapping(VolatilityTier => uint256) public tierMultipliers;

    // Cache validity period
    uint64 public cacheValidityPeriod;

    // ============ Errors ============

    error InvalidPool();
    error InsufficientData();
    error InvalidMultiplier();
    error ZeroAddress();

    // ============ Initializer ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _owner,
        address _vibeAMM
    ) external initializer {
        if (_vibeAMM == address(0)) revert ZeroAddress();

        __Ownable_init(_owner);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        vibeAMM = IVibeAMM(_vibeAMM);
        cacheValidityPeriod = 5 minutes;

        // Set default multipliers
        tierMultipliers[VolatilityTier.LOW] = LOW_MULTIPLIER;
        tierMultipliers[VolatilityTier.MEDIUM] = MEDIUM_MULTIPLIER;
        tierMultipliers[VolatilityTier.HIGH] = HIGH_MULTIPLIER;
        tierMultipliers[VolatilityTier.EXTREME] = EXTREME_MULTIPLIER;
    }

    // ============ External Functions ============

    /**
     * @notice Calculate realized volatility for a pool
     * @param poolId Pool identifier
     * @param period Time period (unused, uses observation window)
     * @return volatility Annualized volatility in basis points
     */
    function calculateRealizedVolatility(
        bytes32 poolId,
        uint32 period
    ) external view override returns (uint256 volatility) {
        return _calculateVolatility(poolId);
    }

    /**
     * @notice Get dynamic fee multiplier based on current volatility
     * @param poolId Pool identifier
     * @return multiplier Fee multiplier (1e18 = 1x)
     */
    function getDynamicFeeMultiplier(
        bytes32 poolId
    ) external view override returns (uint256 multiplier) {
        VolatilityTier tier = _getVolatilityTier(poolId);
        return tierMultipliers[tier];
    }

    /**
     * @notice Get current volatility tier
     * @param poolId Pool identifier
     * @return tier Volatility tier
     */
    function getVolatilityTier(
        bytes32 poolId
    ) external view override returns (VolatilityTier tier) {
        return _getVolatilityTier(poolId);
    }

    /**
     * @notice Update volatility for a pool (called after swaps)
     * @param poolId Pool identifier
     */
    function updateVolatility(bytes32 poolId) external override {
        PoolVolatilityData storage data = poolData[poolId];

        // Get current price from AMM
        uint256 currentPrice = _getCurrentPrice(poolId);
        if (currentPrice == 0) return;

        // Check if enough time has passed since last observation
        uint64 lastTimestamp = data.count > 0
            ? data.observations[data.index].timestamp
            : 0;

        if (block.timestamp < lastTimestamp + OBSERVATION_INTERVAL) {
            return; // Too soon for new observation
        }

        // Add new observation
        uint8 nextIndex = (data.index + 1) % MAX_OBSERVATIONS;
        data.observations[nextIndex] = PriceObservation({
            timestamp: uint64(block.timestamp),
            price: uint192(currentPrice)
        });
        data.index = nextIndex;

        if (data.count < MAX_OBSERVATIONS) {
            data.count++;
        }

        // Invalidate cache
        data.lastCacheUpdate = 0;

        // Emit event for off-chain monitoring (only if enough data for calculation)
        if (data.count >= 3) {
            uint256 vol = _calculateVolatility(poolId);
            emit VolatilityUpdated(poolId, vol, _volatilityToTier(vol));
        }
    }

    /**
     * @notice Get volatility data for a pool
     * @param poolId Pool identifier
     * @return volatility Current volatility in bps
     * @return tier Current tier
     * @return lastUpdate Last cache update timestamp
     */
    function getVolatilityData(
        bytes32 poolId
    ) external view override returns (
        uint256 volatility,
        VolatilityTier tier,
        uint64 lastUpdate
    ) {
        PoolVolatilityData storage data = poolData[poolId];

        // Use cache if valid
        if (data.lastCacheUpdate > 0 &&
            block.timestamp < data.lastCacheUpdate + cacheValidityPeriod) {
            volatility = data.cachedVolatility;
        } else {
            volatility = _calculateVolatility(poolId);
        }

        tier = _volatilityToTier(volatility);
        lastUpdate = data.lastCacheUpdate;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set fee multiplier for a volatility tier
     * @param tier Volatility tier
     * @param multiplier New multiplier (1e18 = 1x)
     */
    function setTierMultiplier(
        VolatilityTier tier,
        uint256 multiplier
    ) external onlyOwner {
        if (multiplier < PRECISION || multiplier > 5 * PRECISION) {
            revert InvalidMultiplier();
        }

        tierMultipliers[tier] = multiplier;
        emit FeeMultiplierChanged(tier, multiplier);
    }

    /**
     * @notice Set cache validity period
     * @param period New period in seconds
     */
    function setCacheValidityPeriod(uint64 period) external onlyOwner {
        cacheValidityPeriod = period;
    }

    /**
     * @notice Set VibeAMM address
     * @param _vibeAMM New AMM address
     */
    function setVibeAMM(address _vibeAMM) external onlyOwner {
        if (_vibeAMM == address(0)) revert ZeroAddress();
        vibeAMM = IVibeAMM(_vibeAMM);
    }

    // ============ Internal Functions ============

    /**
     * @notice Calculate realized volatility using variance of log returns
     * @param poolId Pool identifier
     * @return volatility Annualized volatility in basis points
     */
    function _calculateVolatility(bytes32 poolId) internal view returns (uint256 volatility) {
        PoolVolatilityData storage data = poolData[poolId];

        if (data.count < 3) {
            return 0; // Need at least 3 observations
        }

        // Calculate log returns and their variance
        uint256 sumSquaredReturns;
        uint256 sumReturns;
        uint256 returnCount;

        uint8 currentIdx = data.index;
        uint192 prevPrice = data.observations[currentIdx].price;

        for (uint8 i = 1; i < data.count; i++) {
            uint8 idx = (currentIdx + MAX_OBSERVATIONS - i) % MAX_OBSERVATIONS;
            uint192 price = data.observations[idx].price;

            if (price > 0 && prevPrice > 0) {
                // Calculate return as (price - prevPrice) / prevPrice
                // Using fixed point with PRECISION scaling
                int256 returnVal;
                if (prevPrice >= price) {
                    returnVal = -int256((uint256(prevPrice - price) * PRECISION) / prevPrice);
                } else {
                    returnVal = int256((uint256(price - prevPrice) * PRECISION) / prevPrice);
                }

                sumReturns += uint256(returnVal > 0 ? returnVal : -returnVal);
                sumSquaredReturns += uint256(returnVal * returnVal) / PRECISION;
                returnCount++;
            }

            prevPrice = price;
        }

        if (returnCount < 2) {
            return 0;
        }

        // Calculate variance: E[X^2] - E[X]^2
        uint256 meanReturn = sumReturns / returnCount;
        uint256 meanSquaredReturn = sumSquaredReturns / returnCount;

        // Variance (avoiding underflow)
        uint256 variance;
        if (meanSquaredReturn >= (meanReturn * meanReturn) / PRECISION) {
            variance = meanSquaredReturn - (meanReturn * meanReturn) / PRECISION;
        }

        // Standard deviation (square root approximation)
        uint256 stdDev = _sqrt(variance);

        // Annualize: multiply by sqrt(periods per year)
        // Assuming 5-minute observations: 365 * 24 * 12 = 105,120 periods/year
        // sqrt(105120) ≈ 324
        uint256 annualizedVol = (stdDev * ANNUALIZATION_FACTOR) / PRECISION;

        // Convert to basis points
        volatility = (annualizedVol * BPS_PRECISION) / PRECISION;

        return volatility;
    }

    /**
     * @notice Get current price from AMM
     * @param poolId Pool identifier
     * @return price Current spot price
     */
    function _getCurrentPrice(bytes32 poolId) internal view returns (uint256 price) {
        try vibeAMM.getSpotPrice(poolId) returns (uint256 spotPrice) {
            return spotPrice;
        } catch {
            return 0;
        }
    }

    /**
     * @notice Convert volatility to tier
     * @param volatility Volatility in bps
     * @return tier Volatility tier
     */
    function _volatilityToTier(uint256 volatility) internal pure returns (VolatilityTier tier) {
        if (volatility < LOW_THRESHOLD) {
            return VolatilityTier.LOW;
        } else if (volatility < MEDIUM_THRESHOLD) {
            return VolatilityTier.MEDIUM;
        } else if (volatility < HIGH_THRESHOLD) {
            return VolatilityTier.HIGH;
        } else {
            return VolatilityTier.EXTREME;
        }
    }

    /**
     * @notice Get volatility tier for pool
     * @param poolId Pool identifier
     * @return tier Volatility tier
     */
    function _getVolatilityTier(bytes32 poolId) internal view returns (VolatilityTier tier) {
        uint256 volatility = _calculateVolatility(poolId);
        return _volatilityToTier(volatility);
    }

    /**
     * @notice Integer square root (Babylonian method)
     * @param x Value to take sqrt of
     * @return y Square root
     */
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;

        uint256 z = (x + 1) / 2;
        y = x;

        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
