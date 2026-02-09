"""
USDT Flow Model

Models USDT flows as leverage-enabling and volatility-amplifying.

Key insight from True Price framework:
    $1B USDT mint → Flows to derivatives exchanges → Enables $10-50B notional leverage
    This is NOT genuine capital - it's leverage fuel

USDT flows:
- Do NOT directly influence True Price level
- DO increase expected volatility (σ)
- DO reduce trust in spot price inputs
- DO raise manipulation probability
"""

import numpy as np
from typing import Optional

from ..config import StablecoinConfig
from ..models.stablecoin import USDTImpact
from ..models.leverage import LeverageState


class USDTFlowModel:
    """
    Models USDT flows as leverage-enabling and volatility-amplifying.
    """

    def __init__(self, config: StablecoinConfig):
        """
        Initialize USDT flow model.

        Args:
            config: Stablecoin configuration
        """
        self.config = config

    def compute_impact(
        self,
        flow_data,  # StablecoinFlowData
        leverage_state: Optional[LeverageState] = None
    ) -> USDTImpact:
        """
        Compute impact of USDT flows on True Price model.

        Args:
            flow_data: Stablecoin flow data
            leverage_state: Current leverage state

        Returns:
            USDTImpact with volatility multiplier, trust reduction, and manipulation adjustment
        """
        # Normalize inputs
        mint_normalized = self._normalize(
            flow_data.usdt_mint_volume_24h,
            self.config.usdt_typical_mint_volume
        )
        derivatives_normalized = self._normalize(
            flow_data.usdt_derivatives_flow,
            self.config.usdt_typical_derivatives_flow
        )

        # Compute OI correlation if leverage state available
        oi_correlation = 0.0
        if leverage_state is not None and flow_data.usdt_hourly_flows:
            oi_correlation = self._compute_oi_correlation(flow_data, leverage_state)

        # Volatility amplification
        # Large USDT flows to derivatives venues = expect volatility
        derivatives_ratio = flow_data.usdt_derivatives_flow / (
            flow_data.usdt_derivatives_flow + flow_data.usdt_spot_flow + 1
        )

        vol_multiplier = self.config.usdt_volatility_mult_base + (
            0.5 * mint_normalized +
            0.3 * derivatives_ratio +
            0.2 * max(0, oi_correlation)
        )
        vol_multiplier = min(self.config.usdt_volatility_mult_max, vol_multiplier)

        # Trust reduction in spot prices
        # When USDT enables leverage, spot prices reflect leverage, not value
        trust_reduction = 0.5 * (vol_multiplier - 1.0)
        trust_reduction = max(0, min(1, trust_reduction))

        # Manipulation probability adjustment
        # Large concentrated flows = higher manipulation probability
        manip_adjustment = 0.2 * derivatives_normalized
        manip_adjustment = max(0, min(0.3, manip_adjustment))

        return USDTImpact(
            volatility_multiplier=vol_multiplier,
            trust_reduction=trust_reduction,
            manipulation_prob_adjustment=manip_adjustment,
        )

    def _normalize(self, value: float, typical: float) -> float:
        """Normalize value relative to typical, capped at 2.0"""
        if typical == 0:
            return 0
        return min(2.0, value / typical)

    def _compute_oi_correlation(
        self,
        flow_data,
        leverage_state: LeverageState
    ) -> float:
        """
        Compute correlation between USDT flows and OI changes.

        High correlation = USDT is enabling leverage
        Low correlation = USDT may be for spot or custody

        Uses lagged correlation (USDT typically precedes OI by 1-4 hours)
        """
        usdt_flows = np.array(flow_data.usdt_hourly_flows[-24:])

        if len(usdt_flows) < 5:
            return 0.0

        # We don't have hourly OI data in this model, so we estimate
        # based on current OI state
        # In production, this would use actual hourly OI changes

        # Simplified: use mint volume correlation with OI level
        if leverage_state.open_interest == 0:
            return 0.0

        # High USDT + high OI change = high correlation
        recent_usdt = np.mean(usdt_flows[-4:])
        typical_usdt = np.mean(usdt_flows) + 1e-10

        if recent_usdt > typical_usdt * 1.5:
            # Recent USDT spike
            if leverage_state.oi_change_5m > 0.01:  # 1% OI increase
                return 0.8
            elif leverage_state.oi_change_5m > 0:
                return 0.5
        return 0.2
