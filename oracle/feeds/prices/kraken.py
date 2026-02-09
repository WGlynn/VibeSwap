"""
Kraken price feed.

Fetches real-time spot prices from Kraken API.
Uses the public ticker endpoint (no auth required).
"""

import aiohttp
from typing import Dict, Optional, List
from dataclasses import dataclass

from ..base import DataFeed, FeedError


@dataclass
class KrakenPrice:
    """Kraken price data"""
    symbol: str
    price: float
    bid: float
    ask: float
    volume_24h: float
    vwap_24h: float  # Kraken provides VWAP


class KrakenPriceFeed(DataFeed):
    """
    Kraken spot price feed.

    Rate limits: 1 request/second for public endpoints (conservative)
    """

    BASE_URL = "https://api.kraken.com"

    # Map our symbols to Kraken format
    # Kraken uses XBT for Bitcoin, and pairs like XXBTZUSD
    SYMBOL_MAP = {
        "BTC/USDT": "XBTUSDT",
        "ETH/USDT": "ETHUSDT",
        "BTC/USDC": "XBTUSDC",
        "ETH/USDC": "ETHUSDC",
        "BTC/USD": "XXBTZUSD",
        "ETH/USD": "XETHZUSD",
    }

    def __init__(self, cache_ttl: float = 1.0):
        super().__init__(
            name="kraken",
            rate_limit=1.0,  # Kraken is more conservative
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

    async def _fetch(self, symbol: str) -> KrakenPrice:
        """Fetch price for a single symbol"""
        kraken_symbol = self.SYMBOL_MAP.get(symbol)
        if not kraken_symbol:
            # Try direct conversion
            kraken_symbol = symbol.replace("/", "").replace("BTC", "XBT")

        session = await self._get_session()

        async with session.get(
            f"{self.BASE_URL}/0/public/Ticker",
            params={"pair": kraken_symbol}
        ) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise FeedError(f"Kraken API error {resp.status}: {text}")

            data = await resp.json()

        if data.get("error") and len(data["error"]) > 0:
            raise FeedError(f"Kraken API error: {data['error']}")

        # Kraken returns data keyed by pair name (which may differ)
        result = data.get("result", {})
        if not result:
            raise FeedError(f"No data returned for {symbol}")

        # Get the first (and only) result
        ticker_key = list(result.keys())[0]
        ticker = result[ticker_key]

        # Kraken ticker format:
        # a = ask [price, whole lot volume, lot volume]
        # b = bid [price, whole lot volume, lot volume]
        # c = last trade [price, lot volume]
        # v = volume [today, last 24 hours]
        # p = vwap [today, last 24 hours]

        return KrakenPrice(
            symbol=symbol,
            price=float(ticker["c"][0]),  # Last trade price
            bid=float(ticker["b"][0]),
            ask=float(ticker["a"][0]),
            volume_24h=float(ticker["v"][1]) * float(ticker["c"][0]),  # Convert to quote
            vwap_24h=float(ticker["p"][1]),
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

    async def get_ticker(self, symbol: str) -> KrakenPrice:
        """Get full ticker data"""
        return await self.fetch_with_retry(symbol)
