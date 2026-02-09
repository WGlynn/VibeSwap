"""
Time-varying covariance matrices for Kalman filter.

The key innovation: observation noise variance increases with:
- Leverage stress (price driven by forced flows)
- Orderbook quality degradation (spoofing detected)
- Liquidation cascades
- USDT flows (leverage enablement)

And may decrease with:
- USDC flows confirming the trend (genuine capital)
"""

import numpy as np
from typing import Optional, Dict

from ..config import KalmanConfig, VenueConfig
from ..models.stablecoin import StablecoinState
from ..models.leverage import LeverageStress


class CovarianceManager:
    """
    Manages time-varying covariance matrices for Kalman filter.
    """

    def __init__(self, config: KalmanConfig):
        """
        Initialize covariance manager.

        Args:
            config: Kalman filter configuration
        """
        self.config = config

    def compute_process_noise(
        self,
        Q_base: np.ndarray,
        stablecoin_state: Optional[StablecoinState] = None
    ) -> np.ndarray:
        """
        Compute time-varying process noise covariance.

        Process noise determines how fast True Price can drift.
        USDC-confirmed trends allow faster drift.

        Args:
            Q_base: Base process noise covariance
            stablecoin_state: Current stablecoin flow state

        Returns:
            Adjusted process noise covariance matrix
        """
        multiplier = 1.0

        if stablecoin_state is not None:
            usdc_impact = stablecoin_state.usdc_impact

            # If USDC confirms trend, allow faster drift
            if usdc_impact.regime_signal == "TREND":
                multiplier = 1.0 + 0.2 * usdc_impact.drift_confidence_adjustment

        return Q_base * multiplier

    def compute_observation_variance(
        self,
        venue: VenueConfig,
        leverage_stress: Optional[LeverageStress] = None,
        orderbook_quality: float = 1.0,  # [0, 1], 1 = perfect
        stablecoin_state: Optional[StablecoinState] = None,
        is_cascade: bool = False
    ) -> float:
        """
        Compute time-varying observation variance for a venue.

        Observation variance increases when:
        - Leverage is high (price driven by forced flows)
        - Orderbook quality is low (spoofing detected)
        - Liquidation cascade in progress
        - USDT flows are elevated (leverage enablement)

        May decrease when:
        - USDC flows confirm the trend (genuine capital)

        Args:
            venue: Venue configuration
            leverage_stress: Current leverage stress
            orderbook_quality: Orderbook quality score [0, 1]
            stablecoin_state: Current stablecoin state
            is_cascade: Whether a cascade is detected

        Returns:
            Observation variance for this venue
        """
        base_variance = self.config.base_observation_var

        # Start with venue-specific reliability
        # Higher reliability = lower base variance
        venue_mult = 2.0 - venue.base_reliability  # 1.2 to 1.5 for typical venues

        # Leverage stress multiplier
        leverage_mult = 1.0
        if leverage_stress is not None:
            leverage_mult = 1 + leverage_stress.score * 5  # Up to 6x during stress

        # Orderbook quality multiplier
        quality_mult = 1 + (1 - orderbook_quality) * 3  # Up to 4x for low quality

        # Cascade multiplier
        cascade_mult = 10.0 if is_cascade else 1.0  # Heavily discount during cascades

        # Stablecoin multiplier
        usdt_mult = 1.0
        usdc_adj = 1.0
        if stablecoin_state is not None:
            # USDT increases variance
            usdt_mult = stablecoin_state.usdt_impact.volatility_multiplier  # 1.0 to 3.0

            # USDC may decrease variance if confirming trend
            if stablecoin_state.usdc_impact.regime_signal == "TREND":
                usdc_adj = 0.9  # 10% reduction

        # Derivatives venue penalty during USDT-dominant periods
        derivatives_mult = 1.0
        if venue.has_derivatives and stablecoin_state is not None:
            if stablecoin_state.flow_ratio.usdt_dominant:
                derivatives_mult = 1.5  # 50% penalty

        return (
            base_variance *
            venue_mult *
            leverage_mult *
            quality_mult *
            cascade_mult *
            usdt_mult *
            usdc_adj *
            derivatives_mult
        )

    def compute_venue_observation_variances(
        self,
        venues: list,
        leverage_stress: Optional[LeverageStress] = None,
        orderbook_qualities: Optional[Dict[str, float]] = None,
        stablecoin_state: Optional[StablecoinState] = None,
        is_cascade: bool = False
    ) -> np.ndarray:
        """
        Compute observation variances for all venues.

        Args:
            venues: List of VenueConfig
            leverage_stress: Current leverage stress
            orderbook_qualities: Dict mapping venue name to quality [0, 1]
            stablecoin_state: Current stablecoin state
            is_cascade: Whether a cascade is detected

        Returns:
            Array of observation variances
        """
        variances = []

        for venue in venues:
            quality = 1.0
            if orderbook_qualities is not None:
                quality = orderbook_qualities.get(venue.name, 1.0)

            var = self.compute_observation_variance(
                venue=venue,
                leverage_stress=leverage_stress,
                orderbook_quality=quality,
                stablecoin_state=stablecoin_state,
                is_cascade=is_cascade,
            )
            variances.append(var)

        return np.array(variances)


def compute_trimmed_median(
    prices: np.ndarray,
    weights: np.ndarray,
    trim_pct: float = 0.1
) -> float:
    """
    Compute weighted trimmed median price.

    Args:
        prices: Array of venue prices
        weights: Array of venue reliability weights
        trim_pct: Fraction of extreme values to exclude

    Returns:
        Trimmed weighted median price
    """
    # Sort by price
    sorted_indices = np.argsort(prices)
    sorted_prices = prices[sorted_indices]
    sorted_weights = weights[sorted_indices]

    # Trim extremes
    n = len(prices)
    trim_n = int(n * trim_pct)
    if trim_n > 0:
        trimmed_prices = sorted_prices[trim_n:n - trim_n]
        trimmed_weights = sorted_weights[trim_n:n - trim_n]
    else:
        trimmed_prices = sorted_prices
        trimmed_weights = sorted_weights

    if len(trimmed_prices) == 0:
        return float(np.median(prices))

    # Weighted median
    cumsum = np.cumsum(trimmed_weights)
    median_idx = np.searchsorted(cumsum, cumsum[-1] / 2)
    median_idx = min(median_idx, len(trimmed_prices) - 1)

    return float(trimmed_prices[median_idx])
