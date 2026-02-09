"""
Binance spot price feed.

Fetches real-time spot prices from Binance API.
Uses the public ticker endpoint (no auth required).
"""

import aiohttp
from typing import Dict, Optional, List
from dataclasses import dataclass

from ..base import DataFeed, FeedError


@dataclass
class BinancePrice:
    """Binance price data"""
    symbol: str
    price: float
    bid: float
    ask: float
    volume_24h: float
    timestamp: int


class BinancePriceFeed(DataFeed):
    """
    Binance spot price feed.

    Rate limits: 1200 requests/minute for general endpoints
    We use 10 req/s to be conservative.
    """

    BASE_URL = "https://api.binance.com"

    # Map our symbols to Binance format
    SYMBOL_MAP = {
        "BTC/USDT": "BTCUSDT",
        "ETH/USDT": "ETHUSDT",
        "BTC/USDC": "BTCUSDC",
        "ETH/USDC": "ETHUSDC",
    }

    def __init__(self, cache_ttl: float = 1.0):
        super().__init__(
            name="binance",
            rate_limit=10.0,
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

    async def _fetch(self, symbol: str) -> BinancePrice:
        """Fetch price for a single symbol"""
        binance_symbol = self.SYMBOL_MAP.get(symbol, symbol.replace("/", ""))

        session = await self._get_session()

        # Get ticker price
        async with session.get(
            f"{self.BASE_URL}/api/v3/ticker/bookTicker",
            params={"symbol": binance_symbol}
        ) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise FeedError(f"Binance API error {resp.status}: {text}")

            book_data = await resp.json()

        # Get 24h stats for volume
        async with session.get(
            f"{self.BASE_URL}/api/v3/ticker/24hr",
            params={"symbol": binance_symbol}
        ) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise FeedError(f"Binance API error {resp.status}: {text}")

            stats_data = await resp.json()

        bid = float(book_data["bidPrice"])
        ask = float(book_data["askPrice"])
        mid = (bid + ask) / 2

        return BinancePrice(
            symbol=symbol,
            price=mid,
            bid=bid,
            ask=ask,
            volume_24h=float(stats_data["quoteVolume"]),
            timestamp=int(stats_data["closeTime"]),
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
            except FeedError as e:
                # Log but continue with other symbols
                pass
        return prices

    async def get_book_ticker(self, symbol: str) -> BinancePrice:
        """Get full book ticker data"""
        return await self.fetch_with_retry(symbol)
