"""
OKX price feed.

Fetches real-time spot prices from OKX API.
"""

import aiohttp
from typing import Dict, Optional, List
from dataclasses import dataclass

from ..base import DataFeed, FeedError


@dataclass
class OKXPrice:
    """OKX price data"""
    symbol: str
    price: float
    bid: float
    ask: float
    volume_24h: float
    timestamp: int


class OKXPriceFeed(DataFeed):
    """
    OKX spot price feed.

    Rate limits: 20 requests/2 seconds for public endpoints
    """

    BASE_URL = "https://www.okx.com"

    # Map our symbols to OKX format
    SYMBOL_MAP = {
        "BTC/USDT": "BTC-USDT",
        "ETH/USDT": "ETH-USDT",
        "BTC/USDC": "BTC-USDC",
        "ETH/USDC": "ETH-USDC",
    }

    def __init__(self, cache_ttl: float = 1.0):
        super().__init__(
            name="okx",
            rate_limit=8.0,
            cache_ttl=cache_ttl,
        )
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def _fetch(self, symbol: str) -> OKXPrice:
        """Fetch price for a single symbol"""
        okx_symbol = self.SYMBOL_MAP.get(symbol, symbol.replace("/", "-"))

        session = await self._get_session()

        # Get ticker
        async with session.get(
            f"{self.BASE_URL}/api/v5/market/ticker",
            params={"instId": okx_symbol}
        ) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise FeedError(f"OKX API error {resp.status}: {text}")

            result = await resp.json()

            if result.get("code") != "0":
                raise FeedError(f"OKX API error: {result.get('msg')}")

            data = result["data"][0]

        return OKXPrice(
            symbol=symbol,
            price=float(data["last"]),
            bid=float(data["bidPx"]),
            ask=float(data["askPx"]),
            volume_24h=float(data["volCcy24h"]),
            timestamp=int(data["ts"]),
        )

    async def get_price(self, symbol: str) -> float:
        """Get current price for symbol"""
        data = await self.fetch_with_retry(symbol)
        return data.price

    async def get_prices(self, symbols: List[str]) -> Dict[str, float]:
        """Get prices for multiple symbols"""
        prices = {}
        for symbol in symbols:
            try:
                data = await self.fetch_with_retry(symbol)
                prices[symbol] = data.price
            except FeedError:
                pass
        return prices

    async def get_ticker(self, symbol: str) -> OKXPrice:
        """Get full ticker data"""
        return await self.fetch_with_retry(symbol)
