"""
Glassnode on-chain data provider.

Provides real on-chain metrics via Glassnode API:
- Realized price
- MVRV ratio
- Exchange flows
- Dormancy metrics

API docs: https://docs.glassnode.com/
"""

import aiohttp
import time
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum

from ..base import DataFeed, FeedError


class GlassnodeResolution(Enum):
    """Data resolution options"""
    HOUR_1 = "1h"
    HOUR_24 = "24h"
    WEEK_1 = "1w"


@dataclass
class GlassnodeMetrics:
    """Comprehensive on-chain metrics from Glassnode"""
    # Price metrics
    realized_price: float
    mvrv_ratio: float
    nupl: float  # Net Unrealized Profit/Loss

    # Exchange flows
    exchange_balance: float
    exchange_netflow_24h: float
    exchange_inflow_24h: float
    exchange_outflow_24h: float

    # Supply metrics
    supply_in_profit_pct: float
    supply_last_active_1y_pct: float  # HODLer supply

    # Activity metrics
    active_addresses_24h: int
    transaction_count_24h: int

    # Advanced
    sopr: float  # Spent Output Profit Ratio
    dormancy_flow: float

    timestamp: int


class GlassnodeFeed(DataFeed):
    """
    Glassnode on-chain data feed.

    Requires API key from https://glassnode.com
    Free tier: Limited metrics, 1 request/10 seconds
    Professional tier: All metrics, higher rate limits
    """

    BASE_URL = "https://api.glassnode.com/v1/metrics"

    # Map our asset names to Glassnode format
    ASSET_MAP = {
        "BTC": "BTC",
        "ETH": "ETH",
        "LTC": "LTC",
    }

    def __init__(
        self,
        api_key: str,
        tier: str = "free",  # "free", "advanced", "professional"
        cache_ttl: float = 300.0,  # 5 minutes - on-chain data doesn't change fast
    ):
        # Rate limits based on tier
        rate_limits = {
            "free": 0.1,       # 1 request per 10 seconds
            "advanced": 1.0,    # 1 request per second
            "professional": 10.0,  # 10 requests per second
        }

        super().__init__(
            name="glassnode",
            rate_limit=rate_limits.get(tier, 0.1),
            cache_ttl=cache_ttl,
        )

        self.api_key = api_key
        self.tier = tier
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={"X-Api-Key": self.api_key}
            )
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def _fetch(self, endpoint: str, asset: str, **params) -> Any:
        """Fetch data from Glassnode API"""
        session = await self._get_session()

        gn_asset = self.ASSET_MAP.get(asset, asset)
        url = f"{self.BASE_URL}/{endpoint}"

        query_params = {
            "a": gn_asset,
            "api_key": self.api_key,
            **params
        }

        async with session.get(url, params=query_params) as resp:
            if resp.status == 401:
                raise FeedError("Glassnode: Invalid API key")
            elif resp.status == 429:
                raise FeedError("Glassnode: Rate limit exceeded")
            elif resp.status != 200:
                text = await resp.text()
                raise FeedError(f"Glassnode API error {resp.status}: {text}")

            data = await resp.json()
            return data

    async def get_metric(
        self,
        category: str,
        metric: str,
        asset: str = "BTC",
        resolution: GlassnodeResolution = GlassnodeResolution.HOUR_24,
    ) -> float:
        """
        Get a single metric value.

        Args:
            category: Metric category (market, indicators, supply, etc.)
            metric: Metric name (price_realized, mvrv, etc.)
            asset: Asset symbol
            resolution: Data resolution

        Returns:
            Latest metric value
        """
        endpoint = f"{category}/{metric}"
        data = await self.fetch_with_retry(endpoint, asset, i=resolution.value)

        if not data:
            raise FeedError(f"Glassnode: No data for {endpoint}")

        # Glassnode returns array of {t: timestamp, v: value}
        latest = data[-1] if isinstance(data, list) else data
        return float(latest.get("v", 0))

    async def get_metrics(self, asset: str = "BTC") -> GlassnodeMetrics:
        """
        Get comprehensive on-chain metrics.

        Fetches multiple metrics in parallel for efficiency.
        """
        import asyncio

        # Define all metrics to fetch
        # Format: (category, metric_name, field_name)
        metrics_to_fetch = [
            ("market", "price_realized_usd", "realized_price"),
            ("indicators", "mvrv", "mvrv_ratio"),
            ("indicators", "nupl", "nupl"),
            ("distribution", "balance_exchanges", "exchange_balance"),
            ("transactions", "transfers_volume_exchanges_net", "exchange_netflow_24h"),
            ("transactions", "transfers_volume_to_exchanges_sum", "exchange_inflow_24h"),
            ("transactions", "transfers_volume_from_exchanges_sum", "exchange_outflow_24h"),
            ("supply", "supply_in_profit", "supply_in_profit_pct"),
            ("supply", "hodl_waves_1y_plus", "supply_last_active_1y_pct"),
            ("addresses", "active_count", "active_addresses_24h"),
            ("transactions", "count", "transaction_count_24h"),
            ("indicators", "sopr", "sopr"),
            ("indicators", "dormancy_flow", "dormancy_flow"),
        ]

        # Create tasks for parallel fetching
        async def fetch_metric(category: str, metric: str) -> tuple:
            try:
                value = await self.get_metric(category, metric, asset)
                return (metric, value)
            except FeedError as e:
                # Log but don't fail - some metrics may not be available
                return (metric, None)

        tasks = [
            fetch_metric(cat, metric)
            for cat, metric, _ in metrics_to_fetch
        ]

        results = await asyncio.gather(*tasks)
        results_dict = dict(results)

        # Build metrics object with defaults for missing values
        return GlassnodeMetrics(
            realized_price=results_dict.get("price_realized_usd") or 0,
            mvrv_ratio=results_dict.get("mvrv") or 1.0,
            nupl=results_dict.get("nupl") or 0,
            exchange_balance=results_dict.get("balance_exchanges") or 0,
            exchange_netflow_24h=results_dict.get("transfers_volume_exchanges_net") or 0,
            exchange_inflow_24h=results_dict.get("transfers_volume_to_exchanges_sum") or 0,
            exchange_outflow_24h=results_dict.get("transfers_volume_from_exchanges_sum") or 0,
            supply_in_profit_pct=results_dict.get("supply_in_profit") or 0.5,
            supply_last_active_1y_pct=results_dict.get("hodl_waves_1y_plus") or 0.5,
            active_addresses_24h=int(results_dict.get("active_count") or 0),
            transaction_count_24h=int(results_dict.get("count") or 0),
            sopr=results_dict.get("sopr") or 1.0,
            dormancy_flow=results_dict.get("dormancy_flow") or 0,
            timestamp=int(time.time()),
        )

    async def get_realized_price(self, asset: str = "BTC") -> float:
        """Get realized price (average cost basis)"""
        return await self.get_metric("market", "price_realized_usd", asset)

    async def get_mvrv(self, asset: str = "BTC") -> float:
        """Get MVRV ratio (Market Value / Realized Value)"""
        return await self.get_metric("indicators", "mvrv", asset)

    async def get_exchange_netflow(self, asset: str = "BTC") -> float:
        """Get 24h exchange netflow (positive = inflows, negative = outflows)"""
        return await self.get_metric(
            "transactions",
            "transfers_volume_exchanges_net",
            asset
        )

    async def get_sopr(self, asset: str = "BTC") -> float:
        """
        Get Spent Output Profit Ratio.

        SOPR > 1: Coins moving at profit (bullish)
        SOPR < 1: Coins moving at loss (bearish)
        SOPR = 1: Break-even (often support/resistance)
        """
        return await self.get_metric("indicators", "sopr", asset)
