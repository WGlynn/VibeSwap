"""
Derivatives Data Aggregator

Combines derivatives data from multiple sources into LeverageState.
"""

import asyncio
import time
from typing import Dict, Optional, List
from dataclasses import dataclass
import logging

from .binance_futures import BinanceFuturesFeed, FuturesData, LiquidationData
from ...models.leverage import LeverageState

logger = logging.getLogger(__name__)


@dataclass
class AggregatedDerivatives:
    """Aggregated derivatives data across venues"""
    symbol: str
    total_open_interest: float
    funding_rate_avg: float
    funding_rate_max: float
    long_liquidations_1h: float
    short_liquidations_1h: float
    mark_index_spread: float  # Mark price vs index price spread
    venues: Dict[str, FuturesData]
    timestamp: int


class DerivativesAggregator:
    """
    Aggregates derivatives data from multiple sources.

    Produces LeverageState for the True Price model.
    """

    def __init__(self, spot_volume_provider=None):
        """
        Initialize derivatives aggregator.

        Args:
            spot_volume_provider: Optional provider for spot volume (for leverage ratio)
        """
        self._feeds = {
            "binance": BinanceFuturesFeed(),
        }
        self._spot_volume_provider = spot_volume_provider
        self._last_oi: Dict[str, float] = {}
        self._last_oi_time: Dict[str, float] = {}

    async def close(self):
        """Close all feed connections"""
        for feed in self._feeds.values():
            await feed.close()

    async def get_derivatives_data(self, symbol: str) -> AggregatedDerivatives:
        """Get aggregated derivatives data for a symbol"""
        # Fetch from all venues in parallel
        tasks = {
            venue: asyncio.create_task(feed.get_futures_data(symbol))
            for venue, feed in self._feeds.items()
        }

        liq_tasks = {
            venue: asyncio.create_task(feed.get_liquidations(symbol))
            for venue, feed in self._feeds.items()
        }

        venues = {}
        total_oi = 0
        funding_rates = []
        mark_index_spreads = []

        for venue, task in tasks.items():
            try:
                data = await task
                venues[venue] = data
                total_oi += data.open_interest
                funding_rates.append(data.funding_rate)
                if data.index_price > 0:
                    spread = (data.mark_price - data.index_price) / data.index_price
                    mark_index_spreads.append(spread)
            except Exception as e:
                logger.warning(f"Failed to fetch derivatives from {venue}: {e}")

        long_liqs = 0
        short_liqs = 0
        for venue, task in liq_tasks.items():
            try:
                liq_data = await task
                long_liqs += liq_data.long_liquidations_1h
                short_liqs += liq_data.short_liquidations_1h
            except Exception as e:
                logger.warning(f"Failed to fetch liquidations from {venue}: {e}")

        return AggregatedDerivatives(
            symbol=symbol,
            total_open_interest=total_oi,
            funding_rate_avg=sum(funding_rates) / len(funding_rates) if funding_rates else 0,
            funding_rate_max=max(funding_rates) if funding_rates else 0,
            long_liquidations_1h=long_liqs,
            short_liquidations_1h=short_liqs,
            mark_index_spread=sum(mark_index_spreads) / len(mark_index_spreads) if mark_index_spreads else 0,
            venues=venues,
            timestamp=int(time.time() * 1000),
        )

    async def get_leverage_state(
        self,
        symbol: str,
        spot_volume_24h: Optional[float] = None
    ) -> LeverageState:
        """
        Get LeverageState for the True Price model.

        Args:
            symbol: Trading pair symbol
            spot_volume_24h: Optional spot volume for leverage ratio calculation

        Returns:
            LeverageState ready for the oracle
        """
        data = await self.get_derivatives_data(symbol)

        # Calculate OI change
        oi_change_5m = 0
        if symbol in self._last_oi:
            time_diff = time.time() - self._last_oi_time.get(symbol, 0)
            if time_diff > 0 and time_diff < 600:  # Within 10 minutes
                oi_change_5m = (data.total_open_interest - self._last_oi[symbol]) / self._last_oi[symbol]

        # Update cache
        self._last_oi[symbol] = data.total_open_interest
        self._last_oi_time[symbol] = time.time()

        # Calculate leverage ratio
        leverage_ratio = 1.0
        if spot_volume_24h and spot_volume_24h > 0:
            leverage_ratio = data.total_open_interest / spot_volume_24h

        return LeverageState(
            open_interest=data.total_open_interest,
            funding_rate=data.funding_rate_avg,
            long_liquidations_1h=data.long_liquidations_1h,
            short_liquidations_1h=data.short_liquidations_1h,
            leverage_ratio=leverage_ratio,
            oi_change_5m=oi_change_5m,
        )
