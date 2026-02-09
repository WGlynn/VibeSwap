"""
Leverage Stress Calculator

Computes composite leverage stress score [0, 1].
High stress = spot prices less reliable for True Price estimation.
"""

from typing import Optional, List
import numpy as np

from ..models.leverage import LeverageState, LeverageStress
from ..models.stablecoin import StablecoinState


class LeverageStressCalculator:
    """
    Calculates leverage stress from multiple components.
    """

    def __init__(
        self,
        typical_oi: float = 10_000_000_000,  # $10B typical OI
        typical_liquidation_volume: float = 50_000_000,  # $50M/hour
    ):
        """
        Initialize calculator.

        Args:
            typical_oi: Typical open interest for normalization
            typical_liquidation_volume: Typical liquidation volume
        """
        self.typical_oi = typical_oi
        self.typical_liquidation_volume = typical_liquidation_volume
        self.oi_history: List[float] = []
        self.funding_history: List[float] = []

    def calculate(
        self,
        leverage_state: LeverageState,
        price_return_1h: float,
        stablecoin_state: Optional[StablecoinState] = None,
    ) -> LeverageStress:
        """
        Compute composite leverage stress score.

        Args:
            leverage_state: Current leverage state
            price_return_1h: Price return in past hour
            stablecoin_state: Current stablecoin state

        Returns:
            LeverageStress with component breakdown
        """
        # Update history
        self._update_history(leverage_state)

        # Component 1: OI relative to historical
        oi_stress = self._compute_oi_stress(leverage_state.open_interest)

        # Component 2: Funding rate extremity
        funding_stress = self._compute_funding_stress(leverage_state.funding_rate)

        # Component 3: Recent liquidation intensity
        liq_intensity = leverage_state.total_liquidations_1h / self.typical_liquidation_volume
        liq_stress = min(1.0, liq_intensity / 5)  # Saturate at 5x typical

        # Component 4: Funding-price divergence
        divergence = leverage_state.funding_rate * (-price_return_1h)
        divergence_stress = max(0, min(1.0, divergence * 10))

        # Component 5: USDT flow stress
        usdt_stress = 0
        if stablecoin_state is not None:
            vol_mult = stablecoin_state.usdt_impact.volatility_multiplier
            usdt_stress = min(1.0, (vol_mult - 1) / 2)

        return LeverageStress.from_components(
            oi_stress=oi_stress,
            funding_stress=funding_stress,
            liq_stress=liq_stress,
            divergence_stress=divergence_stress,
            usdt_stress=usdt_stress,
        )

    def _update_history(self, leverage_state: LeverageState):
        """Update historical data for percentile calculations"""
        self.oi_history.append(leverage_state.open_interest)
        self.funding_history.append(leverage_state.funding_rate)

        # Keep last 90 days of hourly data (90 * 24 = 2160)
        if len(self.oi_history) > 2160:
            self.oi_history = self.oi_history[-2160:]
            self.funding_history = self.funding_history[-2160:]

    def _compute_oi_stress(self, current_oi: float) -> float:
        """
        Compute OI stress based on percentile rank.
        """
        if len(self.oi_history) < 10:
            # Not enough history, use simple normalization
            return min(1.0, current_oi / self.typical_oi)

        # Percentile rank
        percentile = np.percentile(self.oi_history, 50)
        if current_oi <= percentile:
            return 0

        # Scale from median to max
        max_oi = max(self.oi_history)
        if max_oi == percentile:
            return 0

        oi_percentile = (current_oi - percentile) / (max_oi - percentile)
        return max(0, min(1.0, oi_percentile * 2))  # 0 at median, 1 at 100th percentile

    def _compute_funding_stress(self, current_funding: float) -> float:
        """
        Compute funding stress based on z-score.
        """
        if len(self.funding_history) < 10:
            # Not enough history, use absolute threshold
            return min(1.0, abs(current_funding) / 0.001)  # 0.1% = high stress

        mean_funding = np.mean(self.funding_history)
        std_funding = np.std(self.funding_history) + 1e-10

        funding_zscore = abs(current_funding - mean_funding) / std_funding
        return min(1.0, funding_zscore / 3)  # Saturate at 3 sigma
