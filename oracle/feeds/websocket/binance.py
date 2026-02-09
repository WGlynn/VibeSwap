"""
Binance WebSocket feed.

Provides real-time streaming data from Binance:
- Individual symbol tickers (@ticker)
- All market tickers (!ticker@arr)
- Trade streams (@trade)
- Book tickers (@bookTicker)

Docs: https://binance-docs.github.io/apidocs/spot/en/#websocket-market-streams
"""

import json
import time
from typing import Set, Optional, Dict, Any

from .base import WebSocketFeed, WebSocketConfig, PriceUpdate


class BinanceWebSocket(WebSocketFeed):
    """
    Binance WebSocket price feed.

    Supports both spot and futures markets.

    Usage:
        ws = BinanceWebSocket()
        await ws.connect()
        await ws.subscribe(["BTC/USDT", "ETH/USDT"])

        async for price in ws.prices():
            print(f"{price.symbol}: ${price.price}")
    """

    # WebSocket endpoints
    SPOT_URL = "wss://stream.binance.com:9443/ws"
    FUTURES_URL = "wss://fstream.binance.com/ws"

    # Symbol mapping
    SYMBOL_MAP = {
        "BTC/USDT": "btcusdt",
        "ETH/USDT": "ethusdt",
        "BTC/USDC": "btcusdc",
        "ETH/USDC": "ethusdc",
    }

    def __init__(
        self,
        use_futures: bool = False,
        combined_stream: bool = True,
    ):
        """
        Initialize Binance WebSocket.

        Args:
            use_futures: Use futures endpoint instead of spot
            combined_stream: Use combined stream for multiple symbols
        """
        url = self.FUTURES_URL if use_futures else self.SPOT_URL

        super().__init__(
            name="binance_ws",
            config=WebSocketConfig(
                url=url,
                ping_interval=30.0,
                ping_timeout=10.0,
            )
        )

        self.use_futures = use_futures
        self.combined_stream = combined_stream
        self._request_id = 0
        self._symbol_to_stream: Dict[str, str] = {}

    def _convert_symbol(self, symbol: str) -> str:
        """Convert our symbol format to Binance format"""
        return self.SYMBOL_MAP.get(symbol, symbol.replace("/", "").lower())

    def _reverse_symbol(self, binance_symbol: str) -> str:
        """Convert Binance symbol back to our format"""
        # Reverse lookup
        for our_symbol, bn_symbol in self.SYMBOL_MAP.items():
            if bn_symbol == binance_symbol.lower():
                return our_symbol

        # Try to reconstruct (e.g., "BTCUSDT" -> "BTC/USDT")
        symbol = binance_symbol.upper()
        for quote in ["USDT", "USDC", "BUSD", "USD"]:
            if symbol.endswith(quote):
                base = symbol[:-len(quote)]
                return f"{base}/{quote}"

        return binance_symbol

    async def _send_subscriptions(self, symbols: Set[str]):
        """Subscribe to ticker streams"""
        streams = []
        for symbol in symbols:
            bn_symbol = self._convert_symbol(symbol)
            stream = f"{bn_symbol}@ticker"
            streams.append(stream)
            self._symbol_to_stream[symbol] = stream

        self._request_id += 1
        message = {
            "method": "SUBSCRIBE",
            "params": streams,
            "id": self._request_id
        }

        await self._ws.send_str(json.dumps(message))

    async def _send_unsubscriptions(self, symbols: Set[str]):
        """Unsubscribe from streams"""
        streams = [
            self._symbol_to_stream.pop(symbol)
            for symbol in symbols
            if symbol in self._symbol_to_stream
        ]

        if not streams:
            return

        self._request_id += 1
        message = {
            "method": "UNSUBSCRIBE",
            "params": streams,
            "id": self._request_id
        }

        await self._ws.send_str(json.dumps(message))

    async def _handle_message(self, data: str):
        """Handle incoming Binance message"""
        try:
            msg = json.loads(data)

            # Check if it's a subscription response
            if "result" in msg or "id" in msg:
                return

            # Handle ticker update
            if "e" in msg:
                event_type = msg["e"]

                if event_type == "24hrTicker":
                    price = self._parse_ticker(msg)
                    if price:
                        self._emit_price(price)

                elif event_type == "bookTicker":
                    price = self._parse_book_ticker(msg)
                    if price:
                        self._emit_price(price)

        except json.JSONDecodeError:
            pass
        except Exception as e:
            pass  # Silently ignore malformed messages

    def _parse_ticker(self, msg: Dict[str, Any]) -> Optional[PriceUpdate]:
        """Parse 24hr ticker message"""
        try:
            symbol = self._reverse_symbol(msg["s"])

            return PriceUpdate(
                symbol=symbol,
                price=float(msg["c"]),  # Last price
                bid=float(msg["b"]),    # Best bid
                ask=float(msg["a"]),    # Best ask
                volume_24h=float(msg["q"]),  # Quote volume
                timestamp=msg["E"] / 1000,   # Event time (ms -> s)
                venue="binance",
            )
        except (KeyError, ValueError):
            return None

    def _parse_book_ticker(self, msg: Dict[str, Any]) -> Optional[PriceUpdate]:
        """Parse book ticker message"""
        try:
            symbol = self._reverse_symbol(msg["s"])

            bid = float(msg["b"])
            ask = float(msg["a"])

            return PriceUpdate(
                symbol=symbol,
                price=(bid + ask) / 2,  # Mid price
                bid=bid,
                ask=ask,
                volume_24h=0,  # Not provided in book ticker
                timestamp=time.time(),
                venue="binance",
            )
        except (KeyError, ValueError):
            return None

    async def subscribe_book_ticker(self, symbols: list):
        """
        Subscribe to book ticker (best bid/ask only).

        More lightweight than full ticker, useful for spread monitoring.
        """
        streams = []
        for symbol in symbols:
            bn_symbol = self._convert_symbol(symbol)
            stream = f"{bn_symbol}@bookTicker"
            streams.append(stream)

        self._request_id += 1
        message = {
            "method": "SUBSCRIBE",
            "params": streams,
            "id": self._request_id
        }

        await self._ws.send_str(json.dumps(message))

    async def subscribe_trades(self, symbols: list):
        """Subscribe to real-time trade stream"""
        streams = []
        for symbol in symbols:
            bn_symbol = self._convert_symbol(symbol)
            stream = f"{bn_symbol}@trade"
            streams.append(stream)

        self._request_id += 1
        message = {
            "method": "SUBSCRIBE",
            "params": streams,
            "id": self._request_id
        }

        await self._ws.send_str(json.dumps(message))
