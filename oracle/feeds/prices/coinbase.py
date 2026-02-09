"""
Coinbase price feed.

Fetches real-time spot prices from Coinbase API.
Uses the public ticker endpoint (no auth required).
"""

import aiohttp
from typing import Dict, Optional, List
from dataclasses import dataclass

from ..base import DataFeed, FeedError


@dataclass
class CoinbasePrice:
    """Coinbase price data"""
    symbol: str
    price: float
    bid: float
    ask: float
    volume_24h: float
    timestamp: str


class CoinbasePriceFeed(DataFeed):
    """
    Coinbase spot price feed.

    Rate limits: 10 requests/second for public endpoints
    """

    BASE_URL = "https://api.exchange.coinbase.com"

    # Map our symbols to Coinbase format
    SYMBOL_MAP = {
        "BTC/USDT": "BTC-USDT",
        "ETH/USDT": "ETH-USDT",
        "BTC/USDC": "BTC-USD",  # Coinbase uses USD (backed by USDC)
        "ETH/USDC": "ETH-USD",
        "BTC/USD": "BTC-USD",
        "ETH/USD": "ETH-USD",
    }

    def __init__(self, cache_ttl: float = 1.0):
        super().__init__(
            name="coinbase",
            rate_limit=8.0,  # Conservative
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

    async def _fetch(self, symbol: str) -> CoinbasePrice:
        """Fetch price for a single symbol"""
        cb_symbol = self.SYMBOL_MAP.get(symbol, symbol.replace("/", "-"))

        session = await self._get_session()

        # Get ticker
        async with session.get(
            f"{self.BASE_URL}/products/{cb_symbol}/ticker"
        ) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise FeedError(f"Coinbase API error {resp.status}: {text}")

            data = await resp.json()

        # Get 24h stats
        async with session.get(
            f"{self.BASE_URL}/products/{cb_symbol}/stats"
        ) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise FeedError(f"Coinbase API error {resp.status}: {text}")

            stats = await resp.json()

        return CoinbasePrice(
            symbol=symbol,
            price=float(data["price"]),
            bid=float(data["bid"]),
            ask=float(data["ask"]),
            volume_24h=float(stats["volume"]) * float(data["price"]),  # Convert to quote
            timestamp=data["time"],
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

    async def get_ticker(self, symbol: str) -> CoinbasePrice:
        """Get full ticker data"""
        return await self.fetch_with_retry(symbol)
