"""
Kraken WebSocket feed.

Provides real-time streaming data from Kraken:
- Ticker channel
- Trade channel
- Book channel

Docs: https://docs.kraken.com/websockets/
"""

import json
import time
from typing import Set, Optional, Dict, Any, List

from .base import WebSocketFeed, WebSocketConfig, PriceUpdate


class KrakenWebSocket(WebSocketFeed):
    """
    Kraken WebSocket price feed.

    Usage:
        ws = KrakenWebSocket()
        await ws.connect()
        await ws.subscribe(["BTC/USDT", "ETH/USDT"])

        async for price in ws.prices():
            print(f"{price.symbol}: ${price.price}")
    """

    WS_URL = "wss://ws.kraken.com"

    # Symbol mapping - Kraken uses XBT for Bitcoin
    SYMBOL_MAP = {
        "BTC/USDT": "XBT/USDT",
        "ETH/USDT": "ETH/USDT",
        "BTC/USDC": "XBT/USDC",
        "ETH/USDC": "ETH/USDC",
        "BTC/USD": "XBT/USD",
        "ETH/USD": "ETH/USD",
    }

    def __init__(self):
        super().__init__(
            name="kraken_ws",
            config=WebSocketConfig(
                url=self.WS_URL,
                ping_interval=30.0,
            )
        )

        self._channel_to_symbol: Dict[int, str] = {}
        self._subscription_status: Dict[str, bool] = {}

    def _convert_symbol(self, symbol: str) -> str:
        """Convert our symbol format to Kraken format"""
        return self.SYMBOL_MAP.get(symbol, symbol.replace("BTC", "XBT"))

    def _reverse_symbol(self, kraken_symbol: str) -> str:
        """Convert Kraken symbol back to our format"""
        for our_symbol, their_symbol in self.SYMBOL_MAP.items():
            if their_symbol == kraken_symbol:
                return our_symbol
        return kraken_symbol.replace("XBT", "BTC")

    async def _send_subscriptions(self, symbols: Set[str]):
        """Subscribe to ticker channel"""
        pairs = [self._convert_symbol(s) for s in symbols]

        message = {
            "event": "subscribe",
            "pair": pairs,
            "subscription": {
                "name": "ticker"
            }
        }

        await self._ws.send_str(json.dumps(message))

    async def _send_unsubscriptions(self, symbols: Set[str]):
        """Unsubscribe from channels"""
        pairs = [self._convert_symbol(s) for s in symbols]

        message = {
            "event": "unsubscribe",
            "pair": pairs,
            "subscription": {
                "name": "ticker"
            }
        }

        await self._ws.send_str(json.dumps(message))

    async def _handle_message(self, data: str):
        """Handle incoming Kraken message"""
        try:
            msg = json.loads(data)

            # Handle events (subscription status, errors, etc.)
            if isinstance(msg, dict):
                event = msg.get("event")

                if event == "subscriptionStatus":
                    self._handle_subscription_status(msg)
                elif event == "heartbeat":
                    pass
                elif event == "systemStatus":
                    pass
                elif event == "error":
                    pass

            # Handle data arrays (ticker updates)
            elif isinstance(msg, list) and len(msg) >= 4:
                # Format: [channelID, data, channelName, pair]
                channel_name = msg[-2] if len(msg) > 3 else None

                if channel_name == "ticker":
                    price = self._parse_ticker(msg)
                    if price:
                        self._emit_price(price)

        except json.JSONDecodeError:
            pass

    def _handle_subscription_status(self, msg: Dict[str, Any]):
        """Handle subscription status message"""
        status = msg.get("status")
        pair = msg.get("pair")

        if status == "subscribed" and pair:
            channel_id = msg.get("channelID")
            if channel_id:
                symbol = self._reverse_symbol(pair)
                self._channel_to_symbol[channel_id] = symbol
                self._subscription_status[symbol] = True

        elif status == "unsubscribed" and pair:
            symbol = self._reverse_symbol(pair)
            self._subscription_status[symbol] = False

    def _parse_ticker(self, msg: List) -> Optional[PriceUpdate]:
        """
        Parse ticker array message.

        Kraken ticker format:
        [channelID, tickerData, "ticker", "XBT/USD"]

        tickerData = {
            "a": [ask_price, whole_lot_volume, lot_volume],
            "b": [bid_price, whole_lot_volume, lot_volume],
            "c": [last_price, lot_volume],
            "v": [volume_today, volume_24h],
            "p": [vwap_today, vwap_24h],
            "t": [trades_today, trades_24h],
            "l": [low_today, low_24h],
            "h": [high_today, high_24h],
            "o": [open_today, open_24h]
        }
        """
        try:
            if len(msg) < 4:
                return None

            ticker_data = msg[1]
            pair = msg[-1]
            symbol = self._reverse_symbol(pair)

            # Extract prices
            ask = float(ticker_data["a"][0])
            bid = float(ticker_data["b"][0])
            last = float(ticker_data["c"][0])
            volume_24h = float(ticker_data["v"][1])

            # Convert volume to quote currency
            volume_quote = volume_24h * last

            return PriceUpdate(
                symbol=symbol,
                price=last,
                bid=bid,
                ask=ask,
                volume_24h=volume_quote,
                timestamp=time.time(),
                venue="kraken",
            )
        except (KeyError, ValueError, IndexError):
            return None

    async def subscribe_trades(self, symbols: list):
        """Subscribe to trade stream"""
        pairs = [self._convert_symbol(s) for s in symbols]

        message = {
            "event": "subscribe",
            "pair": pairs,
            "subscription": {
                "name": "trade"
            }
        }

        await self._ws.send_str(json.dumps(message))

    async def subscribe_book(self, symbols: list, depth: int = 10):
        """
        Subscribe to order book stream.

        Args:
            symbols: Symbols to subscribe
            depth: Book depth (10, 25, 100, 500, 1000)
        """
        pairs = [self._convert_symbol(s) for s in symbols]

        message = {
            "event": "subscribe",
            "pair": pairs,
            "subscription": {
                "name": "book",
                "depth": depth
            }
        }

        await self._ws.send_str(json.dumps(message))
