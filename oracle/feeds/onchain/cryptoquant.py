"""
CryptoQuant on-chain data provider.

Provides real on-chain metrics via CryptoQuant API:
- Exchange flows (specialized in this)
- Miner flows
- Fund flows
- Stablecoin metrics

API docs: https://docs.cryptoquant.com/
"""

import aiohttp
import time
from typing import Optional, Dict, Any
from dataclasses import dataclass

from ..base import DataFeed, FeedError


@dataclass
class CryptoQuantMetrics:
    """On-chain metrics from CryptoQuant"""
    # Exchange flows (CryptoQuant specialty)
    exchange_reserve: float
    exchange_netflow: float
    exchange_inflow_mean: float  # Average deposit size
    exchange_whale_ratio: float  # Large deposits / total

    # Miner metrics
    miner_reserve: float
    miner_outflow: float

    # Fund flows
    fund_flow_ratio: float  # Institutional activity

    # Stablecoins
    stablecoin_exchange_reserve: float
    stablecoin_exchange_ratio: float  # Buying power indicator

    # Market indicators
    estimated_leverage_ratio: float
    open_interest: float
    funding_rates: float

    timestamp: int


class CryptoQuantFeed(DataFeed):
    """
    CryptoQuant on-chain data feed.

    Requires API key from https://cryptoquant.com
    Specialized in exchange flow analysis.
    """

    BASE_URL = "https://api.cryptoquant.com/v1"

    ASSET_MAP = {
        "BTC": "btc",
        "ETH": "eth",
    }

    def __init__(
        self,
        api_key: str,
        cache_ttl: float = 300.0,
    ):
        super().__init__(
            name="cryptoquant",
            rate_limit=1.0,  # Conservative default
            cache_ttl=cache_ttl,
        )

        self.api_key = api_key
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                headers={"Authorization": f"Bearer {self.api_key}"}
            )
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def _fetch(self, endpoint: str, **params) -> Any:
        """Fetch data from CryptoQuant API"""
        session = await self._get_session()

        url = f"{self.BASE_URL}/{endpoint}"

        async with session.get(url, params=params) as resp:
            if resp.status == 401:
                raise FeedError("CryptoQuant: Invalid API key")
            elif resp.status == 429:
                raise FeedError("CryptoQuant: Rate limit exceeded")
            elif resp.status != 200:
                text = await resp.text()
                raise FeedError(f"CryptoQuant API error {resp.status}: {text}")

            data = await resp.json()
            return data

    async def get_exchange_reserve(self, asset: str = "BTC") -> float:
        """
        Get total exchange reserve.

        Decreasing reserve = bullish (coins leaving exchanges)
        Increasing reserve = bearish (coins entering exchanges)
        """
        cq_asset = self.ASSET_MAP.get(asset, asset.lower())
        data = await self.fetch_with_retry(
            f"{cq_asset}/exchange-flows/reserve",
            window="day",
            limit=1
        )

        if data and "result" in data and "data" in data["result"]:
            latest = data["result"]["data"][-1]
            return float(latest.get("reserve", 0))
        return 0

    async def get_exchange_netflow(self, asset: str = "BTC") -> float:
        """Get exchange netflow (inflow - outflow)"""
        cq_asset = self.ASSET_MAP.get(asset, asset.lower())
        data = await self.fetch_with_retry(
            f"{cq_asset}/exchange-flows/netflow",
            window="day",
            limit=1
        )

        if data and "result" in data and "data" in data["result"]:
            latest = data["result"]["data"][-1]
            return float(latest.get("netflow", 0))
        return 0

    async def get_whale_ratio(self, asset: str = "BTC") -> float:
        """
        Get exchange whale ratio.

        High ratio = large players depositing (potential sell pressure)
        Low ratio = retail activity
        """
        cq_asset = self.ASSET_MAP.get(asset, asset.lower())
        data = await self.fetch_with_retry(
            f"{cq_asset}/exchange-flows/whale-ratio",
            window="day",
            limit=1
        )

        if data and "result" in data and "data" in data["result"]:
            latest = data["result"]["data"][-1]
            return float(latest.get("whale_ratio", 0))
        return 0

    async def get_stablecoin_exchange_ratio(self) -> float:
        """
        Get stablecoin supply ratio on exchanges.

        High ratio = high buying power (bullish)
        Low ratio = low buying power (bearish)
        """
        data = await self.fetch_with_retry(
            "stablecoin/exchange-stablecoins-ratio",
            window="day",
            limit=1
        )

        if data and "result" in data and "data" in data["result"]:
            latest = data["result"]["data"][-1]
            return float(latest.get("ratio", 0))
        return 0

    async def get_estimated_leverage_ratio(self, asset: str = "BTC") -> float:
        """
        Get estimated leverage ratio.

        High leverage = overleveraged market (volatile)
        Low leverage = spot-driven market (stable)
        """
        cq_asset = self.ASSET_MAP.get(asset, asset.lower())
        data = await self.fetch_with_retry(
            f"{cq_asset}/market-indicator/estimated-leverage-ratio",
            window="day",
            limit=1
        )

        if data and "result" in data and "data" in data["result"]:
            latest = data["result"]["data"][-1]
            return float(latest.get("estimated_leverage_ratio", 0))
        return 0

    async def get_fund_flow_ratio(self, asset: str = "BTC") -> float:
        """
        Get fund flow ratio (institutional activity indicator).

        Tracks large fund movements vs retail.
        """
        cq_asset = self.ASSET_MAP.get(asset, asset.lower())
        data = await self.fetch_with_retry(
            f"{cq_asset}/fund-data/fund-flow-ratio",
            window="day",
            limit=1
        )

        if data and "result" in data and "data" in data["result"]:
            latest = data["result"]["data"][-1]
            return float(latest.get("fund_flow_ratio", 0))
        return 0

    async def get_metrics(self, asset: str = "BTC") -> CryptoQuantMetrics:
        """Get comprehensive CryptoQuant metrics"""
        import asyncio

        # Fetch all metrics in parallel
        results = await asyncio.gather(
            self.get_exchange_reserve(asset),
            self.get_exchange_netflow(asset),
            self.get_whale_ratio(asset),
            self.get_stablecoin_exchange_ratio(),
            self.get_estimated_leverage_ratio(asset),
            self.get_fund_flow_ratio(asset),
            return_exceptions=True
        )

        # Handle any exceptions gracefully
        def safe_get(idx, default=0):
            val = results[idx]
            return default if isinstance(val, Exception) else val

        return CryptoQuantMetrics(
            exchange_reserve=safe_get(0),
            exchange_netflow=safe_get(1),
            exchange_inflow_mean=0,  # Would need separate call
            exchange_whale_ratio=safe_get(2),
            miner_reserve=0,  # Would need separate call
            miner_outflow=0,
            fund_flow_ratio=safe_get(5),
            stablecoin_exchange_reserve=0,
            stablecoin_exchange_ratio=safe_get(3),
            estimated_leverage_ratio=safe_get(4),
            open_interest=0,
            funding_rates=0,
            timestamp=int(time.time()),
        )
