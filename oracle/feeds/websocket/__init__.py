"""
WebSocket price feeds for real-time streaming data.

Provides persistent connections to exchange WebSocket APIs for:
- Real-time price updates (sub-second latency)
- Order book streaming
- Trade streaming

Much more efficient than HTTP polling for high-frequency updates.

Usage:
    from oracle.feeds.websocket import BinanceWebSocket

    async def main():
        ws = BinanceWebSocket()
        await ws.connect()

        # Subscribe to symbols
        await ws.subscribe(["BTC/USDT", "ETH/USDT"])

        # Get prices as they update
        async for price in ws.prices():
            print(f"{price.symbol}: ${price.price}")

        await ws.close()
"""

from .base import WebSocketFeed, PriceUpdate, ConnectionState
from .binance import BinanceWebSocket
from .coinbase import CoinbaseWebSocket
from .okx import OKXWebSocket
from .kraken import KrakenWebSocket
from .manager import WebSocketManager

__all__ = [
    "WebSocketFeed",
    "PriceUpdate",
    "ConnectionState",
    "BinanceWebSocket",
    "CoinbaseWebSocket",
    "OKXWebSocket",
    "KrakenWebSocket",
    "WebSocketManager",
]
