"""
Stablecoin Flow Aggregator

Combines stablecoin data from multiple sources and classifies flows
for the True Price model's asymmetric USDT/USDC treatment.
"""

import asyncio
import time
from typing import Dict, Optional, List
from dataclasses import dataclass
import logging

from .defillama import DefiLlamaStablecoinFeed, StablecoinSupply
from ...stablecoins.analyzer import StablecoinFlowData

logger = logging.getLogger(__name__)


@dataclass
class ExchangeFlowEstimate:
    """
    Estimated exchange flow breakdown.

    Since direct exchange flow data requires paid APIs (Glassnode, CryptoQuant),
    we estimate based on historical ratios and supply changes.
    """
    total_flow: float
    derivatives_flow: float  # Flow to derivatives-heavy exchanges
    spot_flow: float         # Flow to spot exchanges
    custody_flow: float      # Flow to custody/institutional
    defi_flow: float         # Flow to DeFi protocols


# Historical flow ratios (can be updated with real data)
USDT_FLOW_RATIOS = {
    "derivatives": 0.60,  # 60% to derivatives venues
    "spot": 0.25,         # 25% to spot venues
    "custody": 0.05,      # 5% to custody
    "defi": 0.10,         # 10% to DeFi
}

USDC_FLOW_RATIOS = {
    "derivatives": 0.15,  # 15% to derivatives venues
    "spot": 0.45,         # 45% to spot venues
    "custody": 0.25,      # 25% to custody
    "defi": 0.15,         # 15% to DeFi
}


class StablecoinFlowAggregator:
    """
    Aggregates stablecoin flow data for True Price model.

    Key insight: USDT flows differently than USDC.
    - USDT → derivatives → leverage enablement → volatility
    - USDC → spot/custody → genuine capital → trend confirmation
    """

    def __init__(self):
        self._defillama = DefiLlamaStablecoinFeed()
        self._hourly_flows: Dict[str, List[float]] = {
            "USDT": [],
            "USDC": [],
        }
        self._last_supply: Dict[str, float] = {}

    async def close(self):
        """Close all feed connections"""
        await self._defillama.close()

    async def get_stablecoin_flow_data(
        self,
        price_return_24h: float = 0,
        price_direction: str = "neutral"
    ) -> StablecoinFlowData:
        """
        Get StablecoinFlowData for the True Price model.

        Args:
            price_return_24h: 24h price return for context
            price_direction: "up", "down", or "neutral"

        Returns:
            StablecoinFlowData ready for the stablecoin analyzer
        """
        # Fetch USDT and USDC data in parallel
        usdt_task = asyncio.create_task(self._defillama.get_stablecoin_data("USDT"))
        usdc_task = asyncio.create_task(self._defillama.get_stablecoin_data("USDC"))

        try:
            usdt_data = await usdt_task
        except Exception as e:
            logger.warning(f"Failed to fetch USDT data: {e}")
            usdt_data = None

        try:
            usdc_data = await usdc_task
        except Exception as e:
            logger.warning(f"Failed to fetch USDC data: {e}")
            usdc_data = None

        # Estimate flows
        usdt_flows = self._estimate_flows(usdt_data, "USDT") if usdt_data else None
        usdc_flows = self._estimate_flows(usdc_data, "USDC") if usdc_data else None

        # Update hourly flow tracking
        self._update_hourly_flows(usdt_data, usdc_data)

        return StablecoinFlowData(
            # USDT data
            usdt_mint_volume_24h=max(0, usdt_data.supply_change_24h) if usdt_data else 0,
            usdt_derivatives_flow=usdt_flows.derivatives_flow if usdt_flows else 0,
            usdt_spot_flow=usdt_flows.spot_flow if usdt_flows else 0,
            usdt_hourly_flows=self._hourly_flows.get("USDT", [0] * 24),

            # USDC data
            usdc_mint_volume_24h=max(0, usdc_data.supply_change_24h) if usdc_data else 0,
            usdc_spot_flow=usdc_flows.spot_flow if usdc_flows else 0,
            usdc_custody_flow=usdc_flows.custody_flow if usdc_flows else 0,
            usdc_defi_flow=usdc_flows.defi_flow if usdc_flows else 0,
            usdc_burn_volume_24h=max(0, -usdc_data.supply_change_24h) if usdc_data else 0,

            # Context
            price_return_24h=price_return_24h,
            price_direction=price_direction,
        )

    def _estimate_flows(
        self,
        data: StablecoinSupply,
        stablecoin: str
    ) -> ExchangeFlowEstimate:
        """
        Estimate flow breakdown based on supply change and historical ratios.

        In production, this would use actual exchange flow data from
        Glassnode, CryptoQuant, or on-chain indexing.
        """
        # Use positive supply change as "inflow"
        total_flow = max(0, data.supply_change_24h)

        ratios = USDT_FLOW_RATIOS if stablecoin == "USDT" else USDC_FLOW_RATIOS

        return ExchangeFlowEstimate(
            total_flow=total_flow,
            derivatives_flow=total_flow * ratios["derivatives"],
            spot_flow=total_flow * ratios["spot"],
            custody_flow=total_flow * ratios["custody"],
            defi_flow=total_flow * ratios["defi"],
        )

    def _update_hourly_flows(
        self,
        usdt_data: Optional[StablecoinSupply],
        usdc_data: Optional[StablecoinSupply]
    ):
        """
        Update hourly flow estimates.

        This is a simplified version - ideally would track actual hourly changes.
        """
        if usdt_data:
            # Estimate hourly as 24h / 24
            hourly_estimate = max(0, usdt_data.supply_change_24h / 24)
            self._hourly_flows["USDT"].append(hourly_estimate)
            # Keep last 24 hours
            self._hourly_flows["USDT"] = self._hourly_flows["USDT"][-24:]

        if usdc_data:
            hourly_estimate = max(0, usdc_data.supply_change_24h / 24)
            self._hourly_flows["USDC"].append(hourly_estimate)
            self._hourly_flows["USDC"] = self._hourly_flows["USDC"][-24:]

    async def get_flow_ratio(self) -> float:
        """
        Get USDT/USDC flow ratio.

        > 2.0: USDT-dominant (manipulation likely)
        < 0.5: USDC-dominant (trend likely)
        """
        try:
            usdt_data = await self._defillama.get_stablecoin_data("USDT")
            usdc_data = await self._defillama.get_stablecoin_data("USDC")

            usdt_flow = max(0, usdt_data.supply_change_24h)
            usdc_flow = max(0, usdc_data.supply_change_24h)

            if usdc_flow == 0:
                return 10.0 if usdt_flow > 0 else 1.0

            return usdt_flow / usdc_flow

        except Exception as e:
            logger.warning(f"Failed to compute flow ratio: {e}")
            return 1.0  # Neutral default

    def get_status(self) -> Dict:
        """Get aggregator status"""
        return {
            "defillama_healthy": self._defillama.is_healthy,
            "usdt_hourly_samples": len(self._hourly_flows.get("USDT", [])),
            "usdc_hourly_samples": len(self._hourly_flows.get("USDC", [])),
        }
