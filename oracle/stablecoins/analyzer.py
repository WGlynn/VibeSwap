"""
Stablecoin Flow Analyzer

Analyzes USDT vs USDC flows with asymmetric treatment:
- USDT flows -> volatility amplifier (increases observation noise)
- USDC flows -> capital validator (confirms trend direction)

This is the key innovation in the True Price framework.
"""

from dataclasses import dataclass
from typing import Optional

from ..config import StablecoinConfig
from ..models.stablecoin import (
    StablecoinState,
    FlowRatio,
    USDTImpact,
    USDCImpact,
)
from ..models.leverage import LeverageState
from .usdt_model import USDTFlowModel
from .usdc_model import USDCFlowModel


@dataclass
class StablecoinFlowData:
    """Raw stablecoin flow data"""
    # USDT data
    usdt_mint_volume_24h: float
    usdt_derivatives_flow: float
    usdt_spot_flow: float
    usdt_hourly_flows: list  # Past 24 hours

    # USDC data
    usdc_mint_volume_24h: float
    usdc_spot_flow: float
    usdc_custody_flow: float
    usdc_defi_flow: float
    usdc_burn_volume_24h: float = 0

    # Context
    price_return_24h: float = 0
    price_direction: str = "neutral"  # "up", "down", "neutral"


class StablecoinFlowAnalyzer:
    """
    Analyzes USDT vs USDC flows with asymmetric treatment.

    USDT flows -> volatility amplifier (increases observation noise)
    USDC flows -> capital validator (confirms trend direction)
    """

    def __init__(self, config: StablecoinConfig):
        """
        Initialize analyzer.

        Args:
            config: Stablecoin configuration
        """
        self.config = config
        self.usdt_model = USDTFlowModel(config)
        self.usdc_model = USDCFlowModel(config)

    def analyze(
        self,
        flow_data: StablecoinFlowData,
        leverage_state: Optional[LeverageState] = None
    ) -> StablecoinState:
        """
        Compute comprehensive stablecoin state.

        Args:
            flow_data: Raw stablecoin flow data
            leverage_state: Current leverage state for correlation analysis

        Returns:
            Complete StablecoinState for True Price model
        """
        # Compute USDT impact
        usdt_impact = self.usdt_model.compute_impact(flow_data, leverage_state)

        # Compute USDC impact
        usdc_impact = self.usdc_model.compute_impact(flow_data)

        # Compute flow ratio
        flow_ratio = self._compute_flow_ratio(flow_data)

        return StablecoinState(
            usdt_impact=usdt_impact,
            usdc_impact=usdc_impact,
            flow_ratio=flow_ratio,
        )

    def _compute_flow_ratio(self, flow_data: StablecoinFlowData) -> FlowRatio:
        """
        Compute USDT/USDC flow ratio as regime indicator.

        Ratio interpretation:
            > 2.0: USDT-dominant (high leverage risk, manipulation likely)
            1.0-2.0: Mixed, moderate leverage
            < 0.5: USDC-dominant (genuine capital, trend likely)
        """
        # Total flows (use derivatives + spot for USDT, spot + custody + defi for USDC)
        usdt_total = flow_data.usdt_derivatives_flow + flow_data.usdt_spot_flow
        usdc_total = (
            flow_data.usdc_spot_flow +
            flow_data.usdc_custody_flow +
            flow_data.usdc_defi_flow
        )

        return FlowRatio.from_flows(usdt_total, usdc_total)

    def get_kalman_adjustments(
        self,
        stablecoin_state: StablecoinState
    ) -> dict:
        """
        Get Kalman filter parameter adjustments based on stablecoin state.

        Returns dict with:
        - observation_noise_mult: Multiplier for R matrix
        - process_noise_mult: Multiplier for Q matrix
        - venue_weight_adjustments: Dict of venue -> weight multiplier
        """
        usdt_impact = stablecoin_state.usdt_impact
        usdc_impact = stablecoin_state.usdc_impact

        # Observation noise adjustment (from USDT)
        observation_noise_mult = usdt_impact.volatility_multiplier

        # Process noise adjustment (from USDC)
        process_noise_mult = 1.0
        if usdc_impact.regime_signal == "TREND":
            process_noise_mult = 1.0 + 0.2 * usdc_impact.drift_confidence_adjustment

        # Venue weight adjustments during USDT-dominant periods
        venue_weight_adjustments = {}
        if stablecoin_state.flow_ratio.usdt_dominant:
            venue_weight_adjustments = {
                "binance": 0.5,   # Reduce weight on derivatives-heavy
                "bybit": 0.5,
                "okx": 0.6,
                "coinbase": 1.2,  # Increase weight on spot-heavy
                "kraken": 1.2,
            }

        return {
            "observation_noise_mult": observation_noise_mult,
            "process_noise_mult": process_noise_mult,
            "venue_weight_adjustments": venue_weight_adjustments,
        }
