"""
Base WebSocket feed class.

Provides common functionality for WebSocket connections:
- Automatic reconnection
- Heartbeat/ping handling
- Message parsing
- Connection state management
"""

import asyncio
import json
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional, Dict, Any, List, Set, AsyncIterator, Callable
import logging

import aiohttp

logger = logging.getLogger(__name__)


class ConnectionState(Enum):
    """WebSocket connection states"""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    CLOSED = "closed"


@dataclass
class PriceUpdate:
    """Real-time price update from WebSocket"""
    symbol: str
    price: float
    bid: float
    ask: float
    volume_24h: float
    timestamp: float
    venue: str

    @property
    def spread_bps(self) -> float:
        """Bid-ask spread in basis points"""
        if self.bid == 0:
            return 0
        return (self.ask - self.bid) / self.bid * 10000

    @property
    def mid_price(self) -> float:
        """Mid price between bid and ask"""
        return (self.bid + self.ask) / 2


@dataclass
class WebSocketConfig:
    """WebSocket connection configuration"""
    url: str
    ping_interval: float = 30.0  # Send ping every N seconds
    ping_timeout: float = 10.0   # Wait N seconds for pong
    reconnect_delay: float = 1.0  # Initial reconnect delay
    max_reconnect_delay: float = 60.0  # Max reconnect delay
    max_reconnect_attempts: int = 0  # 0 = unlimited


class WebSocketFeed(ABC):
    """
    Abstract base class for WebSocket price feeds.

    Provides:
    - Automatic connection management
    - Reconnection with exponential backoff
    - Heartbeat handling
    - Message routing

    Subclasses implement exchange-specific logic.
    """

    def __init__(
        self,
        name: str,
        config: Optional[WebSocketConfig] = None,
    ):
        self.name = name
        self.config = config or WebSocketConfig(url="")

        self._state = ConnectionState.DISCONNECTED
        self._session: Optional[aiohttp.ClientSession] = None
        self._ws: Optional[aiohttp.ClientWebSocketResponse] = None

        self._subscriptions: Set[str] = set()
        self._price_callbacks: List[Callable[[PriceUpdate], None]] = []
        self._price_queue: asyncio.Queue[PriceUpdate] = asyncio.Queue()

        self._reconnect_attempts = 0
        self._last_message_time: float = 0
        self._message_count = 0

        self._tasks: List[asyncio.Task] = []

    @property
    def state(self) -> ConnectionState:
        return self._state

    @property
    def is_connected(self) -> bool:
        return self._state == ConnectionState.CONNECTED

    @property
    def subscriptions(self) -> Set[str]:
        return self._subscriptions.copy()

    async def connect(self) -> bool:
        """
        Establish WebSocket connection.

        Returns True if connection successful.
        """
        if self._state in (ConnectionState.CONNECTED, ConnectionState.CONNECTING):
            return True

        self._state = ConnectionState.CONNECTING
        logger.info(f"{self.name}: Connecting to WebSocket...")

        try:
            if self._session is None or self._session.closed:
                self._session = aiohttp.ClientSession()

            self._ws = await self._session.ws_connect(
                self.config.url,
                heartbeat=self.config.ping_interval,
            )

            self._state = ConnectionState.CONNECTED
            self._reconnect_attempts = 0
            logger.info(f"{self.name}: Connected")

            # Start background tasks
            self._tasks.append(asyncio.create_task(self._message_loop()))
            self._tasks.append(asyncio.create_task(self._heartbeat_loop()))

            # Re-subscribe if we had subscriptions
            if self._subscriptions:
                await self._send_subscriptions(self._subscriptions)

            return True

        except Exception as e:
            logger.error(f"{self.name}: Connection failed: {e}")
            self._state = ConnectionState.DISCONNECTED
            return False

    async def close(self):
        """Close WebSocket connection"""
        self._state = ConnectionState.CLOSED

        # Cancel background tasks
        for task in self._tasks:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._tasks.clear()

        # Close WebSocket
        if self._ws and not self._ws.closed:
            await self._ws.close()

        # Close session
        if self._session and not self._session.closed:
            await self._session.close()

        logger.info(f"{self.name}: Connection closed")

    async def subscribe(self, symbols: List[str]):
        """
        Subscribe to price updates for symbols.

        Args:
            symbols: List of symbols (e.g., ["BTC/USDT", "ETH/USDT"])
        """
        new_symbols = set(symbols) - self._subscriptions
        if not new_symbols:
            return

        self._subscriptions.update(new_symbols)

        if self.is_connected:
            await self._send_subscriptions(new_symbols)

        logger.info(f"{self.name}: Subscribed to {new_symbols}")

    async def unsubscribe(self, symbols: List[str]):
        """Unsubscribe from symbols"""
        to_remove = set(symbols) & self._subscriptions
        if not to_remove:
            return

        self._subscriptions -= to_remove

        if self.is_connected:
            await self._send_unsubscriptions(to_remove)

        logger.info(f"{self.name}: Unsubscribed from {to_remove}")

    def on_price(self, callback: Callable[[PriceUpdate], None]):
        """Register callback for price updates"""
        self._price_callbacks.append(callback)

    async def prices(self) -> AsyncIterator[PriceUpdate]:
        """
        Async iterator for price updates.

        Usage:
            async for price in ws.prices():
                print(price)
        """
        while self._state != ConnectionState.CLOSED:
            try:
                price = await asyncio.wait_for(
                    self._price_queue.get(),
                    timeout=1.0
                )
                yield price
            except asyncio.TimeoutError:
                continue

    async def get_latest_price(self, symbol: str, timeout: float = 5.0) -> Optional[PriceUpdate]:
        """
        Get the latest price for a symbol.

        Waits up to timeout seconds for an update.
        """
        if symbol not in self._subscriptions:
            await self.subscribe([symbol])

        start = time.monotonic()
        while time.monotonic() - start < timeout:
            try:
                price = await asyncio.wait_for(
                    self._price_queue.get(),
                    timeout=0.5
                )
                if price.symbol == symbol:
                    return price
                # Put back if not the symbol we want
                await self._price_queue.put(price)
            except asyncio.TimeoutError:
                continue

        return None

    async def _message_loop(self):
        """Main message receiving loop"""
        while self._state == ConnectionState.CONNECTED:
            try:
                msg = await self._ws.receive(timeout=self.config.ping_timeout)

                if msg.type == aiohttp.WSMsgType.TEXT:
                    self._last_message_time = time.time()
                    self._message_count += 1
                    await self._handle_message(msg.data)

                elif msg.type == aiohttp.WSMsgType.BINARY:
                    self._last_message_time = time.time()
                    self._message_count += 1
                    await self._handle_binary(msg.data)

                elif msg.type == aiohttp.WSMsgType.PING:
                    await self._ws.pong(msg.data)

                elif msg.type == aiohttp.WSMsgType.PONG:
                    pass  # Heartbeat response

                elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.ERROR):
                    logger.warning(f"{self.name}: WebSocket closed/error: {msg}")
                    break

            except asyncio.TimeoutError:
                logger.warning(f"{self.name}: Message timeout")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"{self.name}: Message loop error: {e}")
                break

        # Attempt reconnection if not intentionally closed
        if self._state != ConnectionState.CLOSED:
            await self._reconnect()

    async def _heartbeat_loop(self):
        """Send periodic heartbeats"""
        while self._state == ConnectionState.CONNECTED:
            try:
                await asyncio.sleep(self.config.ping_interval)

                if self._ws and not self._ws.closed:
                    await self._ws.ping()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"{self.name}: Heartbeat error: {e}")

    async def _reconnect(self):
        """Attempt to reconnect with exponential backoff"""
        if self._state == ConnectionState.CLOSED:
            return

        self._state = ConnectionState.RECONNECTING

        max_attempts = self.config.max_reconnect_attempts
        while max_attempts == 0 or self._reconnect_attempts < max_attempts:
            self._reconnect_attempts += 1

            delay = min(
                self.config.reconnect_delay * (2 ** (self._reconnect_attempts - 1)),
                self.config.max_reconnect_delay
            )

            logger.info(
                f"{self.name}: Reconnecting in {delay:.1f}s "
                f"(attempt {self._reconnect_attempts})"
            )

            await asyncio.sleep(delay)

            if await self.connect():
                return

        logger.error(f"{self.name}: Max reconnection attempts reached")
        self._state = ConnectionState.DISCONNECTED

    def _emit_price(self, price: PriceUpdate):
        """Emit price update to callbacks and queue"""
        # Queue for async iteration
        try:
            self._price_queue.put_nowait(price)
        except asyncio.QueueFull:
            # Drop oldest if queue is full
            try:
                self._price_queue.get_nowait()
                self._price_queue.put_nowait(price)
            except asyncio.QueueEmpty:
                pass

        # Callbacks
        for callback in self._price_callbacks:
            try:
                callback(price)
            except Exception as e:
                logger.error(f"{self.name}: Callback error: {e}")

    @abstractmethod
    async def _send_subscriptions(self, symbols: Set[str]):
        """Send subscription messages for symbols"""
        pass

    @abstractmethod
    async def _send_unsubscriptions(self, symbols: Set[str]):
        """Send unsubscription messages"""
        pass

    @abstractmethod
    async def _handle_message(self, data: str):
        """Handle incoming text message"""
        pass

    async def _handle_binary(self, data: bytes):
        """Handle incoming binary message (override if needed)"""
        # Default: try to decode as JSON
        await self._handle_message(data.decode('utf-8'))

    def get_status(self) -> Dict[str, Any]:
        """Get connection status"""
        return {
            "name": self.name,
            "state": self._state.value,
            "subscriptions": list(self._subscriptions),
            "message_count": self._message_count,
            "last_message": self._last_message_time,
            "reconnect_attempts": self._reconnect_attempts,
        }
