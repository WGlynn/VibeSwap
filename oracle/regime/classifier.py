"""
Regime Classifier

Classifies market regime using stablecoin flow signals.

Regimes (in priority order):
1. CASCADE - Active liquidation cascade
2. MANIPULATION - USDT-dominant, leverage-driven distortion
3. TREND - USDC-dominant, genuine price discovery
4. HIGH_LEVERAGE - Elevated leverage but no cascade
5. LOW_VOLATILITY - Stable, low leverage, tight bands
6. NORMAL - Default market conditions
"""

from typing import Optional

from ..config import RegimeConfig
from ..models.regime import Regime, RegimeType
from ..models.stablecoin import StablecoinState
from ..models.leverage import LeverageStress, CascadeDetection


class RegimeClassifier:
    """
    Classifies current market regime using stablecoin flow signals.
    """

    def __init__(self, config: RegimeConfig):
        """
        Initialize classifier.

        Args:
            config: Regime classification configuration
        """
        self.config = config

    def classify(
        self,
        leverage_stress: LeverageStress,
        cascade_detection: CascadeDetection,
        stablecoin_state: StablecoinState,
        volatility_annualized: float,
    ) -> Regime:
        """
        Classify current regime incorporating stablecoin signals.

        Priority-based classification ensures most severe conditions
        are detected first.

        Args:
            leverage_stress: Current leverage stress assessment
            cascade_detection: Cascade detection result
            stablecoin_state: Current stablecoin state
            volatility_annualized: Annualized volatility [0, 1+]

        Returns:
            Regime classification with confidence
        """
        # Priority 1: Check for cascade (highest priority)
        if cascade_detection.is_cascade:
            return Regime.cascade(confidence=cascade_detection.confidence)

        # Priority 2: Check stablecoin-based manipulation signal
        manip_prob = stablecoin_state.flow_ratio.manipulation_probability
        if manip_prob > self.config.manipulation_prob_threshold:
            return Regime.manipulation(confidence=manip_prob)

        # Priority 3: Check for USDC-confirmed trend
        usdc_impact = stablecoin_state.usdc_impact
        if (usdc_impact.regime_signal == "TREND" and
            stablecoin_state.flow_ratio.usdc_dominant):
            return Regime.trend(confidence=usdc_impact.confidence)

        # Priority 4: Check leverage level
        if leverage_stress.score > self.config.leverage_stress_high:
            return Regime.high_leverage(confidence=leverage_stress.score)

        # Priority 5: Check volatility
        if volatility_annualized < self.config.volatility_low_threshold:
            confidence = 1 - volatility_annualized / self.config.volatility_low_threshold
            return Regime.low_volatility(confidence=confidence)

        # Priority 6: Default to normal
        return Regime.normal(confidence=0.8)

    def get_regime_parameters(self, regime: Regime) -> dict:
        """
        Return regime-specific model parameters.

        Args:
            regime: Current regime

        Returns:
            Dict with regime-specific adjustments
        """
        params = {
            RegimeType.TREND: {
                "process_noise_mult": 1.2,      # Allow True Price to drift
                "observation_noise_mult": 0.8,  # Trust observations more
                "band_mult": 0.85,
                "reversion_speed": "slow",      # Don't expect reversion in trends
            },
            RegimeType.LOW_VOLATILITY: {
                "process_noise_mult": 0.5,
                "observation_noise_mult": 0.8,
                "band_mult": 0.8,
                "reversion_speed": "fast",
            },
            RegimeType.NORMAL: {
                "process_noise_mult": 1.0,
                "observation_noise_mult": 1.0,
                "band_mult": 1.0,
                "reversion_speed": "normal",
            },
            RegimeType.HIGH_LEVERAGE: {
                "process_noise_mult": 1.5,
                "observation_noise_mult": 2.0,
                "band_mult": 1.5,
                "reversion_speed": "normal",
            },
            RegimeType.MANIPULATION: {
                "process_noise_mult": 0.3,      # True Price very stable
                "observation_noise_mult": 3.0,  # Don't trust spot
                "band_mult": 1.5,
                "reversion_speed": "fast",      # Expect reversion
            },
            RegimeType.CASCADE: {
                "process_noise_mult": 0.5,
                "observation_noise_mult": 5.0,
                "band_mult": 2.0,
                "reversion_speed": "fast",
            },
        }

        return params.get(regime.type, params[RegimeType.NORMAL])
