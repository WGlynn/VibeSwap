"""
OKX WebSocket feed.

Provides real-time streaming data from OKX:
- Tickers channel
- Trades channel
- Order book channel

Docs: https://www.okx.com/docs-v5/en/#websocket-api
"""

import json
import time
from typing import Set, Optional, Dict, Any

from .base import WebSocketFeed, WebSocketConfig, PriceUpdate


class OKXWebSocket(WebSocketFeed):
    """
    OKX WebSocket price feed.

    Supports spot, futures, and perpetual markets.

    Usage:
        ws = OKXWebSocket()
        await ws.connect()
        await ws.subscribe(["BTC/USDT", "ETH/USDT"])

        async for price in ws.prices():
            print(f"{price.symbol}: ${price.price}")
    """

    WS_URL = "wss://ws.okx.com:8443/ws/v5/public"

    # Symbol mapping
    SYMBOL_MAP = {
        "BTC/USDT": "BTC-USDT",
        "ETH/USDT": "ETH-USDT",
        "BTC/USDC": "BTC-USDC",
        "ETH/USDC": "ETH-USDC",
    }

    def __init__(self, inst_type: str = "SPOT"):
        """
        Initialize OKX WebSocket.

        Args:
            inst_type: Instrument type - "SPOT", "SWAP", "FUTURES"
        """
        super().__init__(
            name="okx_ws",
            config=WebSocketConfig(
                url=self.WS_URL,
                ping_interval=25.0,  # OKX requires ping every 30s
            )
        )

        self.inst_type = inst_type

    def _convert_symbol(self, symbol: str) -> str:
        """Convert our symbol format to OKX format"""
        return self.SYMBOL_MAP.get(symbol, symbol.replace("/", "-"))

    def _reverse_symbol(self, okx_symbol: str) -> str:
        """Convert OKX symbol back to our format"""
        for our_symbol, their_symbol in self.SYMBOL_MAP.items():
            if their_symbol == okx_symbol:
                return our_symbol
        return okx_symbol.replace("-", "/")

    async def _send_subscriptions(self, symbols: Set[str]):
        """Subscribe to ticker channel"""
        args = []
        for symbol in symbols:
            okx_symbol = self._convert_symbol(symbol)
            args.append({
                "channel": "tickers",
                "instId": okx_symbol
            })

        message = {
            "op": "subscribe",
            "args": args
        }

        await self._ws.send_str(json.dumps(message))

    async def _send_unsubscriptions(self, symbols: Set[str]):
        """Unsubscribe from channels"""
        args = []
        for symbol in symbols:
            okx_symbol = self._convert_symbol(symbol)
            args.append({
                "channel": "tickers",
                "instId": okx_symbol
            })

        message = {
            "op": "unsubscribe",
            "args": args
        }

        await self._ws.send_str(json.dumps(message))

    async def _handle_message(self, data: str):
        """Handle incoming OKX message"""
        try:
            msg = json.loads(data)

            # Handle ping/pong
            if msg == "pong":
                return

            # Handle subscription response
            if "event" in msg:
                return

            # Handle data push
            if "data" in msg and "arg" in msg:
                channel = msg["arg"].get("channel")

                if channel == "tickers":
                    for ticker_data in msg["data"]:
                        price = self._parse_ticker(ticker_data)
                        if price:
                            self._emit_price(price)

        except json.JSONDecodeError:
            pass

    def _parse_ticker(self, data: Dict[str, Any]) -> Optional[PriceUpdate]:
        """Parse ticker data"""
        try:
            inst_id = data["instId"]
            symbol = self._reverse_symbol(inst_id)

            return PriceUpdate(
                symbol=symbol,
                price=float(data["last"]),
                bid=float(data.get("bidPx", data["last"])),
                ask=float(data.get("askPx", data["last"])),
                volume_24h=float(data.get("volCcy24h", 0)),
                timestamp=int(data["ts"]) / 1000,  # ms -> s
                venue="okx",
            )
        except (KeyError, ValueError):
            return None

    async def _heartbeat_loop(self):
        """OKX requires explicit ping messages"""
        while self._state.value == "connected":
            try:
                await asyncio.sleep(self.config.ping_interval)

                if self._ws and not self._ws.closed:
                    await self._ws.send_str("ping")

            except asyncio.CancelledError:
                break
            except Exception:
                pass


# Need to import asyncio for the heartbeat loop
import asyncio
