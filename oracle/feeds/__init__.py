"""
Data feeds for True Price Oracle

Provides real-time data from:
- Exchange price feeds (spot prices from multiple venues)
- WebSocket streams (real-time price updates)
- Derivatives data (OI, funding, liquidations)
- Stablecoin flows (USDT/USDC mints, exchange flows)
- On-chain metrics (realized price, exchange flows, MVRV, SOPR)

Usage:
    # HTTP polling (simple)
    from oracle.feeds import DataAggregator

    async def main():
        agg = DataAggregator(symbols=["BTC/USDT"])
        data = await agg.fetch()
        # data is ready for TruePriceOracle.update()

    # WebSocket streaming (real-time)
    from oracle.feeds import WebSocketManager

    async def stream():
        manager = WebSocketManager()
        await manager.connect_all()
        await manager.subscribe(["BTC/USDT"])

        async for price in manager.aggregated_prices():
            print(f"{price.symbol}: ${price.median_price}")
"""

from .base import DataFeed, FeedError, RateLimiter
from .aggregator import DataAggregator, OracleInputData
from .prices import (
    PriceAggregator,
    BinancePriceFeed,
    CoinbasePriceFeed,
    OKXPriceFeed,
    KrakenPriceFeed,
)
from .derivatives import DerivativesAggregator, BinanceFuturesFeed
from .stablecoins import StablecoinFlowAggregator, DefiLlamaStablecoinFeed
from .onchain import OnchainDataProvider, OnchainMetrics
from .websocket import (
    WebSocketFeed,
    WebSocketManager,
    PriceUpdate,
    BinanceWebSocket,
    CoinbaseWebSocket,
    OKXWebSocket,
    KrakenWebSocket,
)

__all__ = [
    # Base classes
    "DataFeed",
    "FeedError",
    "RateLimiter",
    # Main aggregator
    "DataAggregator",
    "OracleInputData",
    # HTTP Price feeds
    "PriceAggregator",
    "BinancePriceFeed",
    "CoinbasePriceFeed",
    "OKXPriceFeed",
    "KrakenPriceFeed",
    # WebSocket feeds
    "WebSocketFeed",
    "WebSocketManager",
    "PriceUpdate",
    "BinanceWebSocket",
    "CoinbaseWebSocket",
    "OKXWebSocket",
    "KrakenWebSocket",
    # Derivatives
    "DerivativesAggregator",
    "BinanceFuturesFeed",
    # Stablecoins
    "StablecoinFlowAggregator",
    "DefiLlamaStablecoinFeed",
    # On-chain
    "OnchainDataProvider",
    "OnchainMetrics",
]
