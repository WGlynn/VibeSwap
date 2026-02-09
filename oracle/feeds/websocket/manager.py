"""
WebSocket Manager

Coordinates multiple WebSocket feeds and provides:
- Unified price stream from all venues
- Automatic failover
- Price aggregation
- Connection health monitoring
"""

import asyncio
import time
from typing import Dict, List, Optional, Set, Any, AsyncIterator
from dataclasses import dataclass
import logging

from .base import WebSocketFeed, PriceUpdate, ConnectionState
from .binance import BinanceWebSocket
from .coinbase import CoinbaseWebSocket
from .okx import OKXWebSocket
from .kraken import KrakenWebSocket

logger = logging.getLogger(__name__)


@dataclass
class AggregatedPriceUpdate:
    """Price update aggregated from multiple venues"""
    symbol: str
    median_price: float
    venue_prices: Dict[str, float]
    best_bid: float
    best_ask: float
    spread_bps: float
    timestamp: float
    venue_count: int


class WebSocketManager:
    """
    Manages multiple WebSocket connections for price streaming.

    Provides:
    - Unified stream from all venues
    - Automatic reconnection
    - Price aggregation across venues
    - Health monitoring

    Usage:
        manager = WebSocketManager()
        await manager.connect_all()
        await manager.subscribe(["BTC/USDT", "ETH/USDT"])

        # Get aggregated prices
        async for price in manager.aggregated_prices():
            print(f"{price.symbol}: ${price.median_price}")

        # Or get raw prices from all venues
        async for price in manager.all_prices():
            print(f"{price.venue}: {price.symbol} ${price.price}")
    """

    def __init__(
        self,
        venues: Optional[List[str]] = None,
        enable_aggregation: bool = True,
        aggregation_window_ms: float = 100.0,
    ):
        """
        Initialize WebSocket manager.

        Args:
            venues: List of venues to connect to (default: all)
            enable_aggregation: Whether to aggregate prices across venues
            aggregation_window_ms: Time window for aggregation in milliseconds
        """
        self.enable_aggregation = enable_aggregation
        self.aggregation_window_ms = aggregation_window_ms

        # Initialize feeds
        available_venues = venues or ["binance", "coinbase", "okx", "kraken"]
        self._feeds: Dict[str, WebSocketFeed] = {}

        feed_classes = {
            "binance": BinanceWebSocket,
            "coinbase": CoinbaseWebSocket,
            "okx": OKXWebSocket,
            "kraken": KrakenWebSocket,
        }

        for venue in available_venues:
            if venue in feed_classes:
                self._feeds[venue] = feed_classes[venue]()

        # State
        self._subscriptions: Set[str] = set()
        self._latest_prices: Dict[str, Dict[str, PriceUpdate]] = {}  # symbol -> venue -> price
        self._price_queue: asyncio.Queue[PriceUpdate] = asyncio.Queue()
        self._aggregated_queue: asyncio.Queue[AggregatedPriceUpdate] = asyncio.Queue()

        self._running = False
        self._tasks: List[asyncio.Task] = []

    @property
    def venues(self) -> List[str]:
        return list(self._feeds.keys())

    @property
    def connected_venues(self) -> List[str]:
        return [
            name for name, feed in self._feeds.items()
            if feed.state == ConnectionState.CONNECTED
        ]

    async def connect_all(self) -> Dict[str, bool]:
        """
        Connect to all configured venues.

        Returns dict of venue -> success status.
        """
        results = {}

        # Connect in parallel
        tasks = {
            venue: asyncio.create_task(feed.connect())
            for venue, feed in self._feeds.items()
        }

        for venue, task in tasks.items():
            try:
                results[venue] = await task
                if results[venue]:
                    # Register callback to forward prices
                    self._feeds[venue].on_price(self._on_price_update)
            except Exception as e:
                logger.error(f"Failed to connect to {venue}: {e}")
                results[venue] = False

        self._running = True

        # Start aggregation task if enabled
        if self.enable_aggregation:
            self._tasks.append(
                asyncio.create_task(self._aggregation_loop())
            )

        return results

    async def close(self):
        """Close all WebSocket connections"""
        self._running = False

        # Cancel tasks
        for task in self._tasks:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        self._tasks.clear()

        # Close all feeds
        await asyncio.gather(*[
            feed.close() for feed in self._feeds.values()
        ])

        logger.info("WebSocket manager closed")

    async def subscribe(self, symbols: List[str]):
        """Subscribe to symbols across all venues"""
        self._subscriptions.update(symbols)

        # Initialize price tracking
        for symbol in symbols:
            if symbol not in self._latest_prices:
                self._latest_prices[symbol] = {}

        # Subscribe on all connected feeds
        tasks = []
        for feed in self._feeds.values():
            if feed.is_connected:
                tasks.append(feed.subscribe(symbols))

        await asyncio.gather(*tasks)

    async def unsubscribe(self, symbols: List[str]):
        """Unsubscribe from symbols"""
        self._subscriptions -= set(symbols)

        tasks = []
        for feed in self._feeds.values():
            if feed.is_connected:
                tasks.append(feed.unsubscribe(symbols))

        await asyncio.gather(*tasks)

    def _on_price_update(self, price: PriceUpdate):
        """Handle price update from any venue"""
        # Store latest price
        if price.symbol not in self._latest_prices:
            self._latest_prices[price.symbol] = {}

        self._latest_prices[price.symbol][price.venue] = price

        # Forward to queue
        try:
            self._price_queue.put_nowait(price)
        except asyncio.QueueFull:
            pass

    async def _aggregation_loop(self):
        """Periodically aggregate prices from all venues"""
        while self._running:
            try:
                await asyncio.sleep(self.aggregation_window_ms / 1000)

                # Aggregate each symbol
                for symbol, venue_prices in self._latest_prices.items():
                    if not venue_prices:
                        continue

                    aggregated = self._aggregate_prices(symbol, venue_prices)
                    if aggregated:
                        try:
                            self._aggregated_queue.put_nowait(aggregated)
                        except asyncio.QueueFull:
                            pass

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Aggregation error: {e}")

    def _aggregate_prices(
        self,
        symbol: str,
        venue_prices: Dict[str, PriceUpdate]
    ) -> Optional[AggregatedPriceUpdate]:
        """Aggregate prices from multiple venues"""
        if not venue_prices:
            return None

        # Filter out stale prices (older than 5 seconds)
        now = time.time()
        fresh_prices = {
            venue: price
            for venue, price in venue_prices.items()
            if now - price.timestamp < 5.0
        }

        if not fresh_prices:
            return None

        # Extract prices
        prices = [p.price for p in fresh_prices.values()]
        bids = [p.bid for p in fresh_prices.values() if p.bid > 0]
        asks = [p.ask for p in fresh_prices.values() if p.ask > 0]

        # Calculate median
        prices.sort()
        n = len(prices)
        if n % 2 == 0:
            median = (prices[n//2 - 1] + prices[n//2]) / 2
        else:
            median = prices[n//2]

        # Best bid/ask across venues
        best_bid = max(bids) if bids else median
        best_ask = min(asks) if asks else median

        # Spread
        spread_bps = (best_ask - best_bid) / best_bid * 10000 if best_bid > 0 else 0

        return AggregatedPriceUpdate(
            symbol=symbol,
            median_price=median,
            venue_prices={v: p.price for v, p in fresh_prices.items()},
            best_bid=best_bid,
            best_ask=best_ask,
            spread_bps=spread_bps,
            timestamp=now,
            venue_count=len(fresh_prices),
        )

    async def all_prices(self) -> AsyncIterator[PriceUpdate]:
        """
        Iterate over all price updates from all venues.

        Yields raw PriceUpdate objects as they arrive.
        """
        while self._running:
            try:
                price = await asyncio.wait_for(
                    self._price_queue.get(),
                    timeout=1.0
                )
                yield price
            except asyncio.TimeoutError:
                continue

    async def aggregated_prices(self) -> AsyncIterator[AggregatedPriceUpdate]:
        """
        Iterate over aggregated prices.

        Yields AggregatedPriceUpdate objects at the aggregation interval.
        """
        while self._running:
            try:
                price = await asyncio.wait_for(
                    self._aggregated_queue.get(),
                    timeout=1.0
                )
                yield price
            except asyncio.TimeoutError:
                continue

    def get_latest_price(self, symbol: str) -> Optional[AggregatedPriceUpdate]:
        """Get latest aggregated price for a symbol (non-blocking)"""
        venue_prices = self._latest_prices.get(symbol, {})
        return self._aggregate_prices(symbol, venue_prices)

    def get_venue_price(self, symbol: str, venue: str) -> Optional[PriceUpdate]:
        """Get latest price from a specific venue"""
        return self._latest_prices.get(symbol, {}).get(venue)

    def get_status(self) -> Dict[str, Any]:
        """Get manager status"""
        return {
            "running": self._running,
            "venues": {
                venue: feed.get_status()
                for venue, feed in self._feeds.items()
            },
            "subscriptions": list(self._subscriptions),
            "connected_count": len(self.connected_venues),
            "total_venues": len(self._feeds),
        }

    async def reconnect_venue(self, venue: str) -> bool:
        """Manually reconnect a specific venue"""
        if venue not in self._feeds:
            return False

        feed = self._feeds[venue]
        await feed.close()

        success = await feed.connect()
        if success:
            feed.on_price(self._on_price_update)
            if self._subscriptions:
                await feed.subscribe(list(self._subscriptions))

        return success


async def create_websocket_manager(
    symbols: List[str],
    venues: Optional[List[str]] = None,
) -> WebSocketManager:
    """
    Factory function to create and initialize a WebSocketManager.

    Args:
        symbols: Symbols to subscribe to
        venues: Venues to connect to (default: all)

    Returns:
        Connected and subscribed WebSocketManager
    """
    manager = WebSocketManager(venues=venues)
    await manager.connect_all()
    await manager.subscribe(symbols)
    return manager
