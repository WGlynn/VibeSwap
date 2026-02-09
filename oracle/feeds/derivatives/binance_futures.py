"""
Binance Futures data feed.

Fetches derivatives data: OI, funding rates, liquidations.
"""

import aiohttp
from typing import Dict, Optional, List
from dataclasses import dataclass
import time

from ..base import DataFeed, FeedError


@dataclass
class FuturesData:
    """Binance futures market data"""
    symbol: str
    open_interest: float       # In USD
    open_interest_change_24h: float  # Percentage
    funding_rate: float        # Per 8 hours
    next_funding_time: int
    mark_price: float
    index_price: float
    volume_24h: float
    timestamp: int


@dataclass
class LiquidationData:
    """Recent liquidation data"""
    symbol: str
    long_liquidations_1h: float   # USD value
    short_liquidations_1h: float  # USD value
    total_liquidations_24h: float
    largest_liquidation: float
    timestamp: int


class BinanceFuturesFeed(DataFeed):
    """
    Binance Futures data feed.

    Provides OI, funding rates, and liquidation data.
    """

    BASE_URL = "https://fapi.binance.com"

    SYMBOL_MAP = {
        "BTC/USDT": "BTCUSDT",
        "ETH/USDT": "ETHUSDT",
    }

    def __init__(self, cache_ttl: float = 5.0):
        super().__init__(
            name="binance_futures",
            rate_limit=5.0,
            cache_ttl=cache_ttl,
        )
        self._session: Optional[aiohttp.ClientSession] = None
        self._liquidation_cache: Dict[str, List] = {}

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def _fetch(self, endpoint: str, params: dict = None) -> dict:
        """Generic fetch method"""
        session = await self._get_session()

        async with session.get(
            f"{self.BASE_URL}{endpoint}",
            params=params or {}
        ) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise FeedError(f"Binance Futures API error {resp.status}: {text}")
            return await resp.json()

    async def get_futures_data(self, symbol: str) -> FuturesData:
        """Get comprehensive futures data for a symbol"""
        binance_symbol = self.SYMBOL_MAP.get(symbol, symbol.replace("/", ""))

        # Fetch multiple endpoints
        premium_index = await self.fetch_with_retry(
            f"/fapi/v1/premiumIndex?symbol={binance_symbol}"
        )

        oi_data = await self.fetch_with_retry(
            f"/fapi/v1/openInterest?symbol={binance_symbol}"
        )

        ticker = await self.fetch_with_retry(
            f"/fapi/v1/ticker/24hr?symbol={binance_symbol}"
        )

        # Parse premium index (contains funding rate)
        if isinstance(premium_index, list):
            premium_index = premium_index[0]

        return FuturesData(
            symbol=symbol,
            open_interest=float(oi_data["openInterest"]) * float(premium_index["markPrice"]),
            open_interest_change_24h=0,  # Would need historical data
            funding_rate=float(premium_index["lastFundingRate"]),
            next_funding_time=int(premium_index["nextFundingTime"]),
            mark_price=float(premium_index["markPrice"]),
            index_price=float(premium_index["indexPrice"]),
            volume_24h=float(ticker["quoteVolume"]),
            timestamp=int(time.time() * 1000),
        )

    async def get_liquidations(self, symbol: str) -> LiquidationData:
        """
        Get recent liquidation data.

        Note: Binance liquidation stream requires websocket.
        This is a simplified version using the force orders endpoint.
        """
        binance_symbol = self.SYMBOL_MAP.get(symbol, symbol.replace("/", ""))

        try:
            # Get recent liquidations (last 1000)
            data = await self.fetch_with_retry(
                f"/fapi/v1/allForceOrders?symbol={binance_symbol}&limit=1000"
            )
        except FeedError:
            # Liquidation data might not be available
            return LiquidationData(
                symbol=symbol,
                long_liquidations_1h=0,
                short_liquidations_1h=0,
                total_liquidations_24h=0,
                largest_liquidation=0,
                timestamp=int(time.time() * 1000),
            )

        # Filter to last hour
        now = time.time() * 1000
        one_hour_ago = now - 3600 * 1000
        twenty_four_hours_ago = now - 24 * 3600 * 1000

        long_liqs_1h = 0
        short_liqs_1h = 0
        total_24h = 0
        largest = 0

        for liq in data:
            liq_time = int(liq["time"])
            liq_value = float(liq["price"]) * float(liq["origQty"])
            side = liq["side"]

            largest = max(largest, liq_value)

            if liq_time > twenty_four_hours_ago:
                total_24h += liq_value

            if liq_time > one_hour_ago:
                if side == "SELL":  # Long liquidation
                    long_liqs_1h += liq_value
                else:  # Short liquidation
                    short_liqs_1h += liq_value

        return LiquidationData(
            symbol=symbol,
            long_liquidations_1h=long_liqs_1h,
            short_liquidations_1h=short_liqs_1h,
            total_liquidations_24h=total_24h,
            largest_liquidation=largest,
            timestamp=int(now),
        )

    async def get_funding_rate(self, symbol: str) -> float:
        """Get current funding rate"""
        data = await self.get_futures_data(symbol)
        return data.funding_rate

    async def get_open_interest(self, symbol: str) -> float:
        """Get current open interest in USD"""
        data = await self.get_futures_data(symbol)
        return data.open_interest
