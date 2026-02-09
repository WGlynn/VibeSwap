"""
USDC Flow Model

Models USDC flows as capital-confirming and trend-validating.

Key insight from True Price framework:
    $1B USDC mint → Flows to spot/custody → $1B actual buying power
    This IS genuine capital movement

USDC flows:
- Marginally increase confidence in slow True Price drift
- Help distinguish trend from manipulation
- Do NOT directly move True Price
"""

from ..config import StablecoinConfig
from ..models.stablecoin import USDCImpact


class USDCFlowModel:
    """
    Models USDC flows as capital-confirming and trend-validating.
    """

    def __init__(self, config: StablecoinConfig):
        """
        Initialize USDC flow model.

        Args:
            config: Stablecoin configuration
        """
        self.config = config

    def compute_impact(self, flow_data) -> USDCImpact:
        """
        Compute impact of USDC flows on True Price model.

        Args:
            flow_data: Stablecoin flow data

        Returns:
            USDCImpact with drift confidence adjustment and regime signal
        """
        # Normalize flows
        spot_normalized = self._normalize(
            flow_data.usdc_spot_flow,
            self.config.usdc_typical_spot_flow
        )
        custody_normalized = self._normalize(
            flow_data.usdc_custody_flow,
            self.config.usdc_typical_custody_flow
        )

        # Capital confirmation score
        # USDC to spot/custody = genuine capital
        capital_score = (
            0.5 * spot_normalized +
            0.3 * custody_normalized +
            0.2 * self._normalize(flow_data.usdc_defi_flow, 100_000_000)
        )
        capital_score = min(1.0, capital_score)

        # Drift confidence adjustment
        # If USDC flows align with price direction, increase confidence
        drift_confidence_adj = 0.0
        if flow_data.price_direction == "up":
            if flow_data.usdc_mint_volume_24h > self.config.usdc_typical_spot_flow:
                drift_confidence_adj = min(
                    self.config.usdc_drift_confidence_max,
                    0.1 * capital_score
                )
        elif flow_data.price_direction == "down":
            if flow_data.usdc_burn_volume_24h > 0:
                drift_confidence_adj = min(
                    self.config.usdc_drift_confidence_max,
                    0.1 * capital_score
                )

        # Regime signal
        regime_signal, confidence = self._compute_regime_signal(flow_data, capital_score)

        return USDCImpact(
            drift_confidence_adjustment=drift_confidence_adj,
            regime_signal=regime_signal,
            confidence=confidence,
        )

    def _normalize(self, value: float, typical: float) -> float:
        """Normalize value relative to typical, capped at 2.0"""
        if typical == 0:
            return 0
        return min(2.0, value / typical)

    def _compute_regime_signal(
        self,
        flow_data,
        capital_score: float
    ) -> tuple:
        """
        Compute whether current price action is trend or manipulation.

        USDC-dominant = more likely trend
        USDT-dominant = more likely manipulation

        Returns:
            Tuple of (signal_label, confidence)
        """
        usdc_flow = (
            flow_data.usdc_spot_flow +
            flow_data.usdc_custody_flow +
            flow_data.usdc_defi_flow
        )
        usdt_flow = flow_data.usdt_derivatives_flow + flow_data.usdt_spot_flow

        total_flow = usdc_flow + usdt_flow + 1e-10
        usdc_ratio = usdc_flow / total_flow

        if usdc_ratio > 0.6:
            return ("TREND", usdc_ratio)
        elif usdc_ratio < 0.3:
            return ("MANIPULATION", 1 - usdc_ratio)
        else:
            return ("UNCERTAIN", 0.5)
