"""
Coinbase WebSocket feed.

Provides real-time streaming data from Coinbase Exchange:
- Ticker channel (real-time price updates)
- Matches channel (executed trades)
- Level2 channel (order book)

Docs: https://docs.cloud.coinbase.com/exchange/docs/websocket-overview
"""

import json
import time
from typing import Set, Optional, Dict, Any

from .base import WebSocketFeed, WebSocketConfig, PriceUpdate


class CoinbaseWebSocket(WebSocketFeed):
    """
    Coinbase Exchange WebSocket feed.

    Usage:
        ws = CoinbaseWebSocket()
        await ws.connect()
        await ws.subscribe(["BTC/USDT", "ETH/USDT"])

        async for price in ws.prices():
            print(f"{price.symbol}: ${price.price}")
    """

    WS_URL = "wss://ws-feed.exchange.coinbase.com"

    # Symbol mapping
    SYMBOL_MAP = {
        "BTC/USDT": "BTC-USDT",
        "ETH/USDT": "ETH-USDT",
        "BTC/USDC": "BTC-USD",
        "ETH/USDC": "ETH-USD",
        "BTC/USD": "BTC-USD",
        "ETH/USD": "ETH-USD",
    }

    def __init__(self):
        super().__init__(
            name="coinbase_ws",
            config=WebSocketConfig(
                url=self.WS_URL,
                ping_interval=30.0,
            )
        )

        self._last_prices: Dict[str, float] = {}
        self._last_volumes: Dict[str, float] = {}

    def _convert_symbol(self, symbol: str) -> str:
        """Convert our symbol format to Coinbase format"""
        return self.SYMBOL_MAP.get(symbol, symbol.replace("/", "-"))

    def _reverse_symbol(self, cb_symbol: str) -> str:
        """Convert Coinbase symbol back to our format"""
        for our_symbol, their_symbol in self.SYMBOL_MAP.items():
            if their_symbol == cb_symbol:
                return our_symbol
        return cb_symbol.replace("-", "/")

    async def _send_subscriptions(self, symbols: Set[str]):
        """Subscribe to ticker channel"""
        product_ids = [self._convert_symbol(s) for s in symbols]

        message = {
            "type": "subscribe",
            "product_ids": product_ids,
            "channels": ["ticker"]
        }

        await self._ws.send_str(json.dumps(message))

    async def _send_unsubscriptions(self, symbols: Set[str]):
        """Unsubscribe from channels"""
        product_ids = [self._convert_symbol(s) for s in symbols]

        message = {
            "type": "unsubscribe",
            "product_ids": product_ids,
            "channels": ["ticker"]
        }

        await self._ws.send_str(json.dumps(message))

    async def _handle_message(self, data: str):
        """Handle incoming Coinbase message"""
        try:
            msg = json.loads(data)
            msg_type = msg.get("type")

            if msg_type == "ticker":
                price = self._parse_ticker(msg)
                if price:
                    self._emit_price(price)

            elif msg_type == "error":
                pass  # Log errors if needed

            elif msg_type in ("subscriptions", "heartbeat"):
                pass  # Ignore control messages

        except json.JSONDecodeError:
            pass

    def _parse_ticker(self, msg: Dict[str, Any]) -> Optional[PriceUpdate]:
        """Parse ticker message"""
        try:
            product_id = msg["product_id"]
            symbol = self._reverse_symbol(product_id)

            price = float(msg["price"])
            bid = float(msg.get("best_bid", price))
            ask = float(msg.get("best_ask", price))

            # Coinbase provides 24h volume
            volume = float(msg.get("volume_24h", 0)) * price

            # Update cached values
            self._last_prices[symbol] = price
            self._last_volumes[symbol] = volume

            # Parse timestamp
            timestamp = time.time()
            if "time" in msg:
                try:
                    from datetime import datetime
                    dt = datetime.fromisoformat(msg["time"].replace("Z", "+00:00"))
                    timestamp = dt.timestamp()
                except:
                    pass

            return PriceUpdate(
                symbol=symbol,
                price=price,
                bid=bid,
                ask=ask,
                volume_24h=volume,
                timestamp=timestamp,
                venue="coinbase",
            )
        except (KeyError, ValueError):
            return None

    async def subscribe_matches(self, symbols: list):
        """
        Subscribe to matches channel (executed trades).

        Useful for volume analysis and trade flow.
        """
        product_ids = [self._convert_symbol(s) for s in symbols]

        message = {
            "type": "subscribe",
            "product_ids": product_ids,
            "channels": ["matches"]
        }

        await self._ws.send_str(json.dumps(message))

    async def subscribe_level2(self, symbols: list):
        """
        Subscribe to level2 order book channel.

        Provides real-time order book updates.
        """
        product_ids = [self._convert_symbol(s) for s in symbols]

        message = {
            "type": "subscribe",
            "product_ids": product_ids,
            "channels": ["level2"]
        }

        await self._ws.send_str(json.dumps(message))
